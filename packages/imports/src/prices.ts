import { and, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { instruments, priceObservations, sourceFiles, type Executor } from '@finance/db';
import type { ParsedInstrument } from '@finance/domain';
import { eq as decEq, type DecimalString, type IsoDate } from '@finance/shared';

export async function findOrCreateInstrument(tx: Executor, workspaceId: string, i: ParsedInstrument) {
  const [existing] = await tx
    .select()
    .from(instruments)
    .where(and(eq(instruments.workspaceId, workspaceId), eq(instruments.exchange, i.exchange), eq(instruments.symbol, i.symbol)));
  if (existing) return existing;
  const [created] = await tx
    .insert(instruments)
    .values({ workspaceId, symbol: i.symbol, exchange: i.exchange, name: i.name, currency: i.currency })
    .returning();
  return created!;
}

export interface NewPriceObservation {
  instrumentId: string;
  observedOn: IsoDate;
  price: DecimalString;
  currency: string;
  priceType: 'daily' | 'trade' | 'manual';
  source: 'statement' | 'csv' | 'manual';
  sourceFileId?: string | null;
  sourceRow?: number | null;
  createdBy?: string | null;
}

export interface PriceRecordResult {
  inserted: number;
  /** Already observed at the same price by another live source; kept for provenance, not a new value. */
  duplicates: number;
  conflicts: number;
}

/**
 * Records price observations with provenance. Every source keeps its own copy so soft-deleting one
 * file never removes a price another live file also reports; readers de-duplicate equal prices.
 * A daily or manual price that disagrees with a live observation for the same instrument, date,
 * currency and type is never silently overwritten: both are marked `conflict` for the user to resolve.
 * Trade prices are execution prices, so several per day are normal and never conflict.
 */
export async function recordPriceObservations(
  tx: Executor,
  workspaceId: string,
  observations: NewPriceObservation[],
): Promise<PriceRecordResult> {
  const result: PriceRecordResult = { inserted: 0, duplicates: 0, conflicts: 0 };
  for (const o of observations) {
    let status: 'active' | 'conflict' = 'active';
    if (o.priceType !== 'trade') {
      const live = await tx
        .select({ id: priceObservations.id, price: priceObservations.price })
        .from(priceObservations)
        .leftJoin(sourceFiles, eq(sourceFiles.id, priceObservations.sourceFileId))
        .where(
          and(
            eq(priceObservations.workspaceId, workspaceId),
            eq(priceObservations.instrumentId, o.instrumentId),
            eq(priceObservations.observedOn, o.observedOn),
            eq(priceObservations.currency, o.currency),
            eq(priceObservations.priceType, o.priceType),
            inArray(priceObservations.status, ['active', 'conflict']),
            or(isNull(priceObservations.sourceFileId), isNull(sourceFiles.deletedAt)),
          ),
        );
      const differing = live.filter((l) => !decEq(l.price, o.price));
      if (live.some((l) => decEq(l.price, o.price))) result.duplicates++;
      if (differing.length) {
        status = 'conflict';
        result.conflicts++;
        await tx
          .update(priceObservations)
          .set({ status: 'conflict' })
          .where(
            inArray(
              priceObservations.id,
              live.map((l) => l.id),
            ),
          );
      }
    }
    await tx.insert(priceObservations).values({
      workspaceId,
      instrumentId: o.instrumentId,
      observedOn: o.observedOn,
      price: o.price,
      currency: o.currency,
      priceType: o.priceType,
      source: o.source,
      sourceFileId: o.sourceFileId ?? null,
      sourceRow: o.sourceRow ?? null,
      status,
      createdBy: o.createdBy ?? null,
    });
    result.inserted++;
  }
  return result;
}

/** Live observations: active status and not from a soft-deleted file. */
export const livePriceCondition = sql`${priceObservations.status} = 'active' and (${priceObservations.sourceFileId} is null or not exists (
  select 1 from source_files sf where sf.id = ${priceObservations.sourceFileId} and sf.deleted_at is not null))`;
