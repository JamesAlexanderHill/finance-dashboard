import { and, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { instruments, priceObservations, priceOverrides, sourceFiles, type Executor } from '@finance/db';
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
    .values({ workspaceId, symbol: i.symbol, exchange: i.exchange, name: i.name, currency: i.currency, isin: i.isin ?? null })
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
    // A newer real observation supersedes the display-only override.
    if (status === 'active') {
      await tx
        .update(priceOverrides)
        .set({ clearedAt: sql`now()` })
        .where(
          and(
            eq(priceOverrides.instrumentId, o.instrumentId),
            isNull(priceOverrides.clearedAt),
            sql`${priceOverrides.setOn} <= ${o.observedOn}`,
          ),
        );
    }
  }
  return result;
}

/** Live observations: active status and not from a soft-deleted file. */
export const livePriceCondition = sql`${priceObservations.status} = 'active' and (${priceObservations.sourceFileId} is null or not exists (
  select 1 from source_files sf where sf.id = ${priceObservations.sourceFileId} and sf.deleted_at is not null))`;

/**
 * Resolves a price conflict by choosing one observation: every live observation for the same
 * instrument, date, currency and type with the chosen price becomes active, and the rest are rejected.
 */
export async function resolvePriceConflict(tx: Executor, workspaceId: string, observationId: string) {
  const [chosen] = await tx
    .select()
    .from(priceObservations)
    .where(and(eq(priceObservations.id, observationId), eq(priceObservations.workspaceId, workspaceId)));
  if (!chosen) throw new Error('Price observation not found');
  const siblings = await tx
    .select({ id: priceObservations.id, price: priceObservations.price })
    .from(priceObservations)
    .where(
      and(
        eq(priceObservations.workspaceId, workspaceId),
        eq(priceObservations.instrumentId, chosen.instrumentId),
        eq(priceObservations.observedOn, chosen.observedOn),
        eq(priceObservations.currency, chosen.currency),
        eq(priceObservations.priceType, chosen.priceType),
        inArray(priceObservations.status, ['active', 'conflict', 'rejected']),
      ),
    );
  for (const s of siblings) {
    await tx
      .update(priceObservations)
      .set({ status: decEq(s.price, chosen.price) ? 'active' : 'rejected' })
      .where(eq(priceObservations.id, s.id));
  }
}

/** Sets the display-only current price for an instrument, replacing any active override. */
export async function setPriceOverride(
  tx: Executor,
  workspaceId: string,
  o: { instrumentId: string; price: DecimalString; currency: string; setOn: IsoDate; userId: string | null },
) {
  await clearPriceOverride(tx, workspaceId, o.instrumentId);
  const [created] = await tx
    .insert(priceOverrides)
    .values({ workspaceId, instrumentId: o.instrumentId, price: o.price, currency: o.currency, setOn: o.setOn, createdBy: o.userId })
    .returning();
  return created!;
}

export async function clearPriceOverride(tx: Executor, workspaceId: string, instrumentId: string) {
  await tx
    .update(priceOverrides)
    .set({ clearedAt: sql`now()` })
    .where(
      and(eq(priceOverrides.workspaceId, workspaceId), eq(priceOverrides.instrumentId, instrumentId), isNull(priceOverrides.clearedAt)),
    );
}

/** Active overrides that no live observation on or after their date has superseded. */
export async function activePriceOverrides(tx: Executor, workspaceId: string) {
  return tx
    .select()
    .from(priceOverrides)
    .where(
      and(
        eq(priceOverrides.workspaceId, workspaceId),
        isNull(priceOverrides.clearedAt),
        sql`not exists (select 1 from price_observations o where o.instrument_id = "price_overrides"."instrument_id"
          and o.observed_on >= "price_overrides"."set_on" and o.status = 'active')`,
      ),
    );
}
