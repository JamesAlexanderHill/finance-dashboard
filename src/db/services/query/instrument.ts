import { eq, and, inArray, isNull, count, sql } from 'drizzle-orm'
import { db } from '~/db'
import { instruments, legs, events, accounts } from '~/db/schema'
import type { PaginationOptions } from '../utils/pagination'

type QueryInstrumentsOpts = PaginationOptions & {
  accountIds?: string[]
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
        balance: sql<string>`coalesce(sum(${legs.unitCount})::text, '0')`.as('balance'),
      })
      .from(instruments)
      .leftJoin(legs, and(eq(legs.instrumentId, instruments.id), eq(legs.userId, userId)))
      .where(where)
      .groupBy(instruments.id)
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
      accountId: events.accountId,
      accountName: accounts.name,
      instrumentId: legs.instrumentId,
      instrumentTicker: instruments.ticker,
      instrumentExponent: instruments.exponent,
      unitCount: sql<string>`SUM(${legs.unitCount})`,
    })
    .from(legs)
    .innerJoin(events, eq(legs.eventId, events.id))
    .innerJoin(accounts, eq(events.accountId, accounts.id))
    .innerJoin(instruments, eq(legs.instrumentId, instruments.id))
    .where(and(eq(events.userId, userId), isNull(events.deletedAt)))
    .groupBy(
      events.accountId,
      accounts.name,
      legs.instrumentId,
      instruments.ticker,
      instruments.exponent,
    )

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

/** Balance for a single instrument, excluding soft-deleted events. */
export async function queryInstrumentBalance(userId: string, instrumentId: string): Promise<bigint> {
  const [result] = await db
    .select({ total: sql<string>`COALESCE(SUM(${legs.unitCount}), 0)` })
    .from(legs)
    .innerJoin(events, eq(legs.eventId, events.id))
    .where(
      and(
        eq(legs.instrumentId, instrumentId),
        eq(legs.userId, userId),
        isNull(events.deletedAt),
      ),
    )

  return BigInt(result?.total ?? '0')
}

export async function queryInstrumentHasLegs(instrumentId: string): Promise<boolean> {
  const [{ total }] = await db
    .select({ total: count() })
    .from(legs)
    .where(eq(legs.instrumentId, instrumentId))

  return total > 0
}
