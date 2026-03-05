import { eq, and, inArray, count, sql } from 'drizzle-orm'
import { db } from '~/db'
import { instruments, legs, events } from '~/db/schema'
import type { RequestContext } from './context'
import { buildPaginatedResult, type PaginationOptions } from './pagination'

// ─── Prepared statements ──────────────────────────────────────────────────────

// Used when no accountIds filter is needed — avoids re-parsing the query plan on every request.
// For the accountIds[] variant, the SQL changes shape per call (inArray length varies),
// so that path stays as a regular dynamic query below.
const preparedGetInstrumentBalances = db
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
  .where(eq(legs.userId, sql.placeholder('userId')))
  .groupBy(
    events.accountId,
    legs.instrumentId,
    instruments.ticker,
    instruments.exponent,
    instruments.name,
  )
  .prepare('instrument_balances_by_user')

// ─── list ─────────────────────────────────────────────────────────────────────

type ListInstrumentsOptions = PaginationOptions & {
  accountIds?: string[]
}

async function list(ctx: RequestContext, opts: ListInstrumentsOptions = {}) {
  const { limit = 1000, offset = 0, accountIds } = opts

  const where = and(
    eq(instruments.userId, ctx.userId),
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
      .leftJoin(
        legs,
        and(eq(legs.instrumentId, instruments.id), eq(legs.userId, ctx.userId)),
      )
      .where(where)
      .groupBy(instruments.id)
      .limit(limit)
      .offset(offset),
    db.select({ total: count() }).from(instruments).where(where),
  ])

  return buildPaginatedResult(data, total, limit, offset)
}

// ─── getBalances ──────────────────────────────────────────────────────────────

async function getBalances(ctx: RequestContext, accountIds?: string[]) {
  if (accountIds?.length) {
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
      .where(and(eq(legs.userId, ctx.userId), inArray(events.accountId, accountIds)))
      .groupBy(
        events.accountId,
        legs.instrumentId,
        instruments.ticker,
        instruments.exponent,
        instruments.name,
      )
  }

  return preparedGetInstrumentBalances.execute({ userId: ctx.userId })
}

export const instrumentService = { list, getBalances }
