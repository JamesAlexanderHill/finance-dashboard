import { eq, and, inArray, isNull, count, desc, gte, sql } from 'drizzle-orm'
import { db } from '~/db'
import { instruments, legs, events, accounts, instrumentCheckpoints } from '~/db/schema'
import type { PaginationOptions } from '../utils/pagination'

type QueryInstrumentsOpts = PaginationOptions & {
  accountIds?: string[]
}

// Fully-qualified reference to instruments.id — required because the
// correlated subqueries below (instrument_checkpoints, legs, events) all
// have their own "id" columns, so a bare "id" would be ambiguous.
const instrumentIdRef = sql.raw('"instruments"."id"')

/**
 * Balance for an instrument as of now: latest completed-month checkpoint
 * (if any) plus the sum of non-deleted legs since that checkpoint's period.
 */
function balanceSinceCheckpointExpr(userId: string) {
  return sql<string>`(
    coalesce((select c.balance from instrument_checkpoints c
      where c.instrument_id = ${instrumentIdRef} and c.user_id = ${userId}
      order by c.period_end desc limit 1), 0)
    + coalesce((select sum(l.unit_count) from legs l
      inner join events e on e.id = l.event_id
      where l.instrument_id = ${instrumentIdRef} and l.user_id = ${userId}
        and e.deleted_at is null
        and e.effective_at >= coalesce((select c2.period_end from instrument_checkpoints c2
          where c2.instrument_id = ${instrumentIdRef} and c2.user_id = ${userId}
          order by c2.period_end desc limit 1), '-infinity'::timestamptz)
      ), 0)
  )`
}

export async function queryInstrumentsWithBalance(userId: string, opts: QueryInstrumentsOpts = {}) {
  const { limit = 1000, offset = 0, accountIds } = opts

  const where = and(
    eq(instruments.userId, userId),
    accountIds?.length ? inArray(instruments.accountId, accountIds) : undefined,
  )

  const [data, [{ total }]] = await Promise.all([
    db
      .select({
        id: instruments.id,
        userId: instruments.userId,
        accountId: instruments.accountId,
        name: instruments.name,
        ticker: instruments.ticker,
        exponent: instruments.exponent,
        balance: balanceSinceCheckpointExpr(userId).as('balance'),
      })
      .from(instruments)
      .where(where)
      .limit(limit)
      .offset(offset),
    db.select({ total: count() }).from(instruments).where(where),
  ])

  return { data, total }
}

export async function queryInstrumentBalances(userId: string, accountIds?: string[]) {
  const where = accountIds?.length
    ? and(eq(legs.userId, userId), inArray(events.accountId, accountIds))
    : eq(legs.userId, userId)

  return db
    .select({
      accountId: events.accountId,
      instrumentId: legs.instrumentId,
      ticker: instruments.ticker,
      exponent: instruments.exponent,
      instrumentName: instruments.name,
      unitBalance: sql<string>`(sum(${legs.unitCount})::text)`.as('unitBalance'),
    })
    .from(legs)
    .innerJoin(events, eq(legs.eventId, events.id))
    .innerJoin(instruments, eq(legs.instrumentId, instruments.id))
    .where(where)
    .groupBy(
      events.accountId,
      legs.instrumentId,
      instruments.ticker,
      instruments.exponent,
      instruments.name,
    )
}

export async function queryAccountBalances(userId: string) {
  const rows = await db
    .select({
      accountId: instruments.accountId,
      accountName: accounts.name,
      instrumentId: instruments.id,
      instrumentTicker: instruments.ticker,
      instrumentExponent: instruments.exponent,
      unitCount: balanceSinceCheckpointExpr(userId),
    })
    .from(instruments)
    .innerJoin(accounts, eq(instruments.accountId, accounts.id))
    .where(and(
      eq(instruments.userId, userId),
      sql`exists (select 1 from legs l inner join events e on e.id = l.event_id where l.instrument_id = ${instrumentIdRef} and l.user_id = ${userId} and e.deleted_at is null)`,
    ))

  return rows.map((r) => ({ ...r, unitCount: BigInt(r.unitCount) }))
}

export async function queryInstrumentById(userId: string, instrumentId: string) {
  const [instrument] = await db
    .select()
    .from(instruments)
    .where(and(eq(instruments.id, instrumentId), eq(instruments.userId, userId)))

  return instrument ?? null
}

export interface AccountBalance {
  accountId: string
  accountName: string
  instrumentId: string
  instrumentTicker: string
  instrumentExponent: number
  unitCount: bigint
}

/**
 * Balance for a single instrument, excluding soft-deleted events: latest
 * completed-month checkpoint (if any) plus the sum of legs since then.
 */
export async function queryInstrumentBalance(userId: string, instrumentId: string): Promise<bigint> {
  const [checkpoint] = await db
    .select({ periodEnd: instrumentCheckpoints.periodEnd, balance: instrumentCheckpoints.balance })
    .from(instrumentCheckpoints)
    .where(and(eq(instrumentCheckpoints.userId, userId), eq(instrumentCheckpoints.instrumentId, instrumentId)))
    .orderBy(desc(instrumentCheckpoints.periodEnd))
    .limit(1)

  const [result] = await db
    .select({ total: sql<string>`COALESCE(SUM(${legs.unitCount}), 0)` })
    .from(legs)
    .innerJoin(events, eq(legs.eventId, events.id))
    .where(
      and(
        eq(legs.instrumentId, instrumentId),
        eq(legs.userId, userId),
        isNull(events.deletedAt),
        checkpoint ? gte(events.effectiveAt, checkpoint.periodEnd) : undefined,
      ),
    )

  return (checkpoint?.balance ?? BigInt(0)) + BigInt(result?.total ?? '0')
}

export async function queryInstrumentHasLegs(instrumentId: string): Promise<boolean> {
  const [{ total }] = await db
    .select({ total: count() })
    .from(legs)
    .where(eq(legs.instrumentId, instrumentId))

  return total > 0
}
