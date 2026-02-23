import { eq, isNull, sql } from "drizzle-orm";
import { db } from "../db";
import { events, legs, instruments, accounts } from "../db/schema";

export interface AccountBalance {
  accountId: string;
  accountName: string;
  instrumentId: string;
  instrumentCode: string;
  instrumentMinorUnit: number;
  instrumentKind: string;
  amountMinor: bigint;
}

/**
 * Compute live balances for all accounts belonging to a user.
 * Balances = SUM(legs.amount_minor) grouped by (accountId, instrumentId),
 * excluding legs from soft-deleted events.
 */
export async function getUserBalances(
  userId: string,
): Promise<AccountBalance[]> {
  const rows = await db
    .select({
      accountId: legs.accountId,
      accountName: accounts.name,
      instrumentId: legs.instrumentId,
      instrumentCode: instruments.code,
      instrumentMinorUnit: instruments.minorUnit,
      instrumentKind: instruments.kind,
      amountMinor: sql<string>`SUM(${legs.amountMinor})`,
    })
    .from(legs)
    .innerJoin(events, eq(legs.eventId, events.id))
    .innerJoin(accounts, eq(legs.accountId, accounts.id))
    .innerJoin(instruments, eq(legs.instrumentId, instruments.id))
    .where(
      sql`${events.userId} = ${userId} AND ${events.deletedAt} IS NULL`,
    )
    .groupBy(
      legs.accountId,
      accounts.name,
      legs.instrumentId,
      instruments.code,
      instruments.minorUnit,
      instruments.kind,
    );

  return rows.map((r) => ({
    ...r,
    amountMinor: BigInt(r.amountMinor),
  }));
}

/** Format an amountMinor as a human-readable decimal string. */
export function formatAmount(amountMinor: bigint, minorUnit: number): string {
  if (minorUnit === 0) {
    return amountMinor.toString();
  }
  const factor = Math.pow(10, minorUnit);
  const value = Number(amountMinor) / factor;
  return value.toLocaleString("en-AU", {
    minimumFractionDigits: minorUnit,
    maximumFractionDigits: minorUnit,
  });
}
