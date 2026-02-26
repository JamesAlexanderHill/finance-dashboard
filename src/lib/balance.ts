import { eq, sql } from 'drizzle-orm'
import { db } from '~/db'
import { events, legs, instruments, accounts } from '~/db/schema'

export interface AccountBalance {
  accountId: string
  accountName: string
  instrumentId: string
  instrumentTicker: string
  instrumentExponent: number
  unitCount: bigint
}

/**
 * Compute live balances for all accounts belonging to a user.
 * Balance = SUM(legs.unit_count) GROUP BY (accountId, instrumentId)
 * Excludes legs from soft-deleted events.
 */
export async function getUserBalances(userId: string): Promise<AccountBalance[]> {
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
    .where(sql`${events.userId} = ${userId} AND ${events.deletedAt} IS NULL`)
    .groupBy(
      events.accountId,
      accounts.name,
      legs.instrumentId,
      instruments.ticker,
      instruments.exponent,
    )

  return rows.map((r) => ({ ...r, unitCount: BigInt(r.unitCount) }))
}

/**
 * Format a unit count with the given exponent (decimal places).
 */
export function formatAmount(unitCount: bigint, exponent: number): string {
  if (exponent === 0) return unitCount.toString()
  const divisor = BigInt(10 ** exponent)
  const whole = unitCount / divisor
  const frac = unitCount % divisor
  const fracStr = frac.toString().padStart(exponent, '0')
  return `${whole}.${fracStr}`
}
