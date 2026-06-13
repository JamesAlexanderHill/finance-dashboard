import { eq, and, inArray, isNull, count, desc, asc, gte, lt, lte, sql } from 'drizzle-orm'
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

export type BalancePoint = {
  period: Date
  balance: bigint
  /** True if this period is after the instrument's last transaction — the balance is carried forward, not observed. */
  projected: boolean
  /** Event description — only populated for `'transaction'`-granularity points. */
  description?: string
}

/** How far back the balance history window extends. */
export type BalanceHistoryRange = '30d' | '90d' | '1y' | 'all'

/** Granularity of each point in the balance history: a fixed period, or one point per transaction. */
export type BalanceHistoryPeriod = 'day' | 'week' | 'month' | 'transaction'

/** Periods handled by the period-aggregated history query (everything but `'transaction'`). */
type AggregatePeriod = Exclude<BalanceHistoryPeriod, 'transaction'>

const RANGE_DAYS: Record<Exclude<BalanceHistoryRange, 'all'>, number> = {
  '30d': 30,
  '90d': 90,
  '1y': 365,
}

// Truncate to the start (UTC midnight) of the period containing `date`.
// Matches Postgres `date_trunc`: weeks start on Monday, months on the 1st.
function truncateToPeriod(date: Date, period: AggregatePeriod): Date {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
  if (period === 'month') return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1))
  if (period === 'week') {
    const daysSinceMonday = (d.getUTCDay() + 6) % 7
    d.setUTCDate(d.getUTCDate() - daysSinceMonday)
  }
  return d
}

function addPeriod(date: Date, period: AggregatePeriod): Date {
  const d = new Date(date)
  if (period === 'day') d.setUTCDate(d.getUTCDate() + 1)
  else if (period === 'week') d.setUTCDate(d.getUTCDate() + 7)
  else d.setUTCMonth(d.getUTCMonth() + 1)
  return d
}

function periodTruncExpr(period: AggregatePeriod) {
  switch (period) {
    case 'day': return sql<string>`date_trunc('day', ${events.effectiveAt})`
    case 'week': return sql<string>`date_trunc('week', ${events.effectiveAt})`
    case 'month': return sql<string>`date_trunc('month', ${events.effectiveAt})`
  }
}

/** Computes the start of the history window for `range` (UTC midnight `RANGE_DAYS` days back, or the first event's date for `'all'`). */
function rangeStartFor(range: BalanceHistoryRange, today: Date, earliest: string | null): Date {
  if (range === 'all') return earliest ? new Date(earliest) : today
  const start = new Date(today)
  start.setUTCDate(start.getUTCDate() - (RANGE_DAYS[range] - 1))
  return start
}

/**
 * The instrument's balance as of `windowStart`: the latest completed-month checkpoint at or
 * before it, plus the sum of non-deleted legs between that checkpoint and `windowStart`.
 */
async function balanceAsOf(userId: string, instrumentId: string, windowStart: Date): Promise<bigint> {
  const [checkpoint] = await db
    .select({ periodEnd: instrumentCheckpoints.periodEnd, balance: instrumentCheckpoints.balance })
    .from(instrumentCheckpoints)
    .where(and(
      eq(instrumentCheckpoints.userId, userId),
      eq(instrumentCheckpoints.instrumentId, instrumentId),
      lte(instrumentCheckpoints.periodEnd, windowStart),
    ))
    .orderBy(desc(instrumentCheckpoints.periodEnd))
    .limit(1)

  const checkpointBalance = checkpoint ? BigInt(checkpoint.balance) : BigInt(0)
  const checkpointEnd = checkpoint?.periodEnd ?? new Date(0)

  const [{ total }] = await db
    .select({ total: sql<string>`COALESCE(SUM(${legs.unitCount}), 0)` })
    .from(legs)
    .innerJoin(events, eq(legs.eventId, events.id))
    .where(and(
      eq(legs.instrumentId, instrumentId),
      eq(legs.userId, userId),
      isNull(events.deletedAt),
      gte(events.effectiveAt, checkpointEnd),
      lt(events.effectiveAt, windowStart),
    ))

  return checkpointBalance + BigInt(total)
}

/**
 * Balance history for an instrument: one point per `period` covering the
 * trailing `range` (or since the first event, for `'all'`), including today.
 * Each point's `balance` is the instrument's balance as of the end of that period.
 */
export async function queryInstrumentBalanceHistory(
  userId: string,
  instrumentId: string,
  range: BalanceHistoryRange = '30d',
  period: AggregatePeriod = 'day',
): Promise<BalancePoint[]> {
  const now = new Date()
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))

  const [{ earliest, latest }] = await db
    .select({
      earliest: sql<string | null>`MIN(${events.effectiveAt})`,
      latest: sql<string | null>`MAX(${events.effectiveAt})`,
    })
    .from(legs)
    .innerJoin(events, eq(legs.eventId, events.id))
    .where(and(eq(legs.instrumentId, instrumentId), eq(legs.userId, userId), isNull(events.deletedAt)))

  const rangeStart = rangeStartFor(range, today, earliest)
  const periodStart = truncateToPeriod(rangeStart, period)

  // Balance as of the start of the window: latest checkpoint at or before it,
  // plus any legs between that checkpoint and the window start.
  const startBalance = await balanceAsOf(userId, instrumentId, periodStart)

  // Net change per period within the window.
  const windowSums = await db
    .select({
      period: periodTruncExpr(period),
      total: sql<string>`SUM(${legs.unitCount})`,
    })
    .from(legs)
    .innerJoin(events, eq(legs.eventId, events.id))
    .where(and(
      eq(legs.instrumentId, instrumentId),
      eq(legs.userId, userId),
      isNull(events.deletedAt),
      gte(events.effectiveAt, periodStart),
    ))
    .groupBy(periodTruncExpr(period))

  const changeByPeriod = new Map<number, bigint>()
  for (const row of windowSums) {
    changeByPeriod.set(new Date(row.period).getTime(), BigInt(row.total))
  }

  const lastActivity = latest ? truncateToPeriod(new Date(latest), period).getTime() : null

  const points: BalancePoint[] = []
  let running = startBalance
  let cursor = new Date(periodStart)
  while (cursor.getTime() <= today.getTime()) {
    running += changeByPeriod.get(cursor.getTime()) ?? BigInt(0)
    points.push({
      period: new Date(cursor),
      balance: running,
      projected: lastActivity !== null && cursor.getTime() > lastActivity,
    })
    cursor = addPeriod(cursor, period)
  }

  return points
}

/**
 * One point per leg (transaction) affecting this instrument within the trailing `range`
 * (or since the first event, for `'all'`), each carrying the running balance immediately
 * after that transaction and the event's description.
 *
 * Points sharing an `effectiveAt` (multiple transactions on the same day, e.g. a deposit
 * followed by a purchase) are nudged forward by 1ms each so they remain distinct,
 * strictly-increasing x-values for the chart's time scale.
 */
export async function queryInstrumentTransactionHistory(
  userId: string,
  instrumentId: string,
  range: BalanceHistoryRange = '30d',
): Promise<BalancePoint[]> {
  const now = new Date()
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))

  const [{ earliest }] = await db
    .select({ earliest: sql<string | null>`MIN(${events.effectiveAt})` })
    .from(legs)
    .innerJoin(events, eq(legs.eventId, events.id))
    .where(and(eq(legs.instrumentId, instrumentId), eq(legs.userId, userId), isNull(events.deletedAt)))

  const rangeStart = rangeStartFor(range, today, earliest)
  const startBalance = await balanceAsOf(userId, instrumentId, rangeStart)

  const transactions = await db
    .select({
      effectiveAt: events.effectiveAt,
      description: events.description,
      unitCount: legs.unitCount,
    })
    .from(legs)
    .innerJoin(events, eq(legs.eventId, events.id))
    .where(and(
      eq(legs.instrumentId, instrumentId),
      eq(legs.userId, userId),
      isNull(events.deletedAt),
      gte(events.effectiveAt, rangeStart),
    ))
    .orderBy(asc(events.effectiveAt), asc(events.id))

  const points: BalancePoint[] = []
  let running = startBalance
  let lastTime = -Infinity
  for (const txn of transactions) {
    running += BigInt(txn.unitCount)
    const time = Math.max(txn.effectiveAt.getTime(), lastTime + 1)
    lastTime = time
    points.push({ period: new Date(time), balance: running, projected: false, description: txn.description })
  }

  return points
}

export async function queryInstrumentHasLegs(instrumentId: string): Promise<boolean> {
  const [{ total }] = await db
    .select({ total: count() })
    .from(legs)
    .where(eq(legs.instrumentId, instrumentId))

  return total > 0
}
