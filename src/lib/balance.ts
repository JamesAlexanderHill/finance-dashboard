import { eq, sql } from 'drizzle-orm'
import { db } from '~/db'
import { events, legs, instruments, accounts } from '~/db/schema'

export interface AccountBalance {
  accountId: string
  accountName: string
  instrumentId: string
  instrumentCode: string
  instrumentMinorUnit: number
  instrumentKind: string
  amountMinor: bigint
}

/**
 * Compute live balances for all accounts belonging to a user.
 * Balance = SUM(legs.amount_minor) GROUP BY (accountId, instrumentId)
 * Excludes legs from soft-deleted events.
 */
export async function getUserBalances(userId: string): Promise<AccountBalance[]> {
  const rows = await db
    .select({
      accountId: events.accountId,
      accountName: accounts.name,
      instrumentId: legs.instrumentId,
      instrumentCode: instruments.code,
      instrumentMinorUnit: instruments.minorUnit,
      instrumentKind: instruments.kind,
      amountMinor: sql<string>`SUM(${legs.amountMinor})`,
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
      instruments.code,
      instruments.minorUnit,
      instruments.kind,
    )

  return rows.map((r) => ({ ...r, amountMinor: BigInt(r.amountMinor) }))
}

/** Format an amountMinor as a localised decimal string using the instrument's minorUnit. */
export function formatAmount(amountMinor: bigint, minorUnit: number): string {
  if (minorUnit === 0) return amountMinor.toString()
  const value = Number(amountMinor) / Math.pow(10, minorUnit)
  return value.toLocaleString('en-AU', {
    minimumFractionDigits: minorUnit,
    maximumFractionDigits: minorUnit,
  })
}
