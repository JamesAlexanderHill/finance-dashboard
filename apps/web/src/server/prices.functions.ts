import { createServerFn } from '@tanstack/react-start';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { idInput, manualPriceInput, resolvePriceConflictInput, startPriceImportInput, type PriceImportSummary } from '@finance/contracts';
import { getDb, instruments, priceObservations, sourceFiles } from '@finance/db';
import {
  activePriceOverrides,
  getStorage,
  previewPriceCsv,
  recordPriceObservations,
  resolvePriceConflict,
  setPriceFileDeleted,
  startPriceImport,
} from '@finance/imports';
import { priceAt } from '@finance/ledger';
import { todayIso } from '@finance/shared';
import { workspaceMiddleware } from './session';
import { loadFxRates } from './valuation.server';

export const listInstruments = createServerFn({ method: 'GET' })
  .middleware([workspaceMiddleware])
  .handler(async ({ context }) =>
    getDb()
      .select({
        id: instruments.id,
        symbol: instruments.symbol,
        exchange: instruments.exchange,
        name: instruments.name,
        currency: instruments.currency,
      })
      .from(instruments)
      .where(eq(instruments.workspaceId, context.workspaceId))
      .orderBy(asc(instruments.symbol)),
  );

export const listPriceFiles = createServerFn({ method: 'GET' })
  .middleware([workspaceMiddleware])
  .handler(async ({ context }) => {
    const rows = await getDb()
      .select({
        id: sourceFiles.id,
        fileName: sourceFiles.originalName,
        uploadedAt: sourceFiles.uploadedAt,
        deletedAt: sourceFiles.deletedAt,
        job: sql<{ id: string; status: string } | null>`(select json_build_object('id', j.id, 'status', j.status) from jobs j
          where j.workspace_id = "source_files"."workspace_id" and j.payload->>'sourceFileId' = "source_files"."id"::text
          order by j.created_at desc limit 1)`,
        summary: sql<PriceImportSummary | null>`(select r.summary from import_results r where r.source_file_id = "source_files"."id"
          order by r.created_at desc limit 1)`,
      })
      .from(sourceFiles)
      .where(and(eq(sourceFiles.workspaceId, context.workspaceId), eq(sourceFiles.kind, 'price_import')))
      .orderBy(desc(sourceFiles.uploadedAt));
    return rows.map((r) => ({ ...r, uploadedAt: r.uploadedAt.toISOString(), deletedAt: r.deletedAt?.toISOString() ?? null }));
  });

export const previewPriceFile = createServerFn({ method: 'GET' })
  .middleware([workspaceMiddleware])
  .validator(idInput)
  .handler(async ({ context, data }) => previewPriceCsv(getDb(), getStorage(), context.workspaceId, data.id));

export const importPriceFile = createServerFn({ method: 'POST' })
  .middleware([workspaceMiddleware])
  .validator(startPriceImportInput)
  .handler(async ({ context, data }) => {
    const job = await startPriceImport(getDb(), context.workspaceId, data.sourceFileId, data.mapping);
    return { jobId: job.id };
  });

export const deletePriceFile = createServerFn({ method: 'POST' })
  .middleware([workspaceMiddleware])
  .validator(idInput)
  .handler(async ({ context, data }) => setPriceFileDeleted(getDb(), context.workspaceId, data.id, true, context.userId));

export const restorePriceFile = createServerFn({ method: 'POST' })
  .middleware([workspaceMiddleware])
  .validator(idInput)
  .handler(async ({ context, data }) => setPriceFileDeleted(getDb(), context.workspaceId, data.id, false, context.userId));

/** Conflicting observations grouped by instrument and date, with where each came from. */
export const listPriceConflicts = createServerFn({ method: 'GET' })
  .middleware([workspaceMiddleware])
  .handler(async ({ context }) => {
    const rows = await getDb()
      .select({
        id: priceObservations.id,
        symbol: instruments.symbol,
        observedOn: priceObservations.observedOn,
        price: priceObservations.price,
        currency: priceObservations.currency,
        priceType: priceObservations.priceType,
        source: priceObservations.source,
        fileName: sourceFiles.originalName,
        sourceRow: priceObservations.sourceRow,
      })
      .from(priceObservations)
      .innerJoin(instruments, eq(instruments.id, priceObservations.instrumentId))
      .leftJoin(sourceFiles, eq(sourceFiles.id, priceObservations.sourceFileId))
      .where(
        and(
          eq(priceObservations.workspaceId, context.workspaceId),
          eq(priceObservations.status, 'conflict'),
          sql`(${sourceFiles.deletedAt} is null)`,
        ),
      )
      .orderBy(desc(priceObservations.observedOn), asc(instruments.symbol), asc(priceObservations.price));
    return [...Map.groupBy(rows, (r) => `${r.symbol} ${r.observedOn} ${r.currency} ${r.priceType}`).entries()].map(([key, options]) => ({
      key,
      symbol: options[0]!.symbol,
      observedOn: options[0]!.observedOn,
      options,
    }));
  });

export const choosePrice = createServerFn({ method: 'POST' })
  .middleware([workspaceMiddleware])
  .validator(resolvePriceConflictInput)
  .handler(async ({ context, data }) => getDb().transaction((tx) => resolvePriceConflict(tx, context.workspaceId, data.observationId)));

export const addManualPrice = createServerFn({ method: 'POST' })
  .middleware([workspaceMiddleware])
  .validator(manualPriceInput)
  .handler(async ({ context, data }) => {
    const [instrument] = await getDb()
      .select()
      .from(instruments)
      .where(and(eq(instruments.id, data.instrumentId), eq(instruments.workspaceId, context.workspaceId)));
    if (!instrument) throw new Error('Instrument not found');
    return getDb().transaction((tx) =>
      recordPriceObservations(tx, context.workspaceId, [
        {
          instrumentId: instrument.id,
          observedOn: data.observedOn,
          price: data.price,
          currency: instrument.currency,
          priceType: 'manual',
          source: 'manual',
          createdBy: context.userId,
        },
      ]),
    );
  });

/** FX rates (AUD per unit of each currency held) with the rate that applies today and any override. */
export const listFxRates = createServerFn({ method: 'GET' })
  .middleware([workspaceMiddleware])
  .handler(async ({ context }) => {
    const [fx, overrides, fxInstruments] = await Promise.all([
      loadFxRates(context.workspaceId),
      activePriceOverrides(getDb(), context.workspaceId),
      getDb()
        .select({ id: instruments.id, symbol: instruments.symbol, currency: instruments.currency })
        .from(instruments)
        .where(and(eq(instruments.workspaceId, context.workspaceId), eq(instruments.exchange, 'FX')))
        .orderBy(asc(instruments.symbol)),
    ]);
    return fxInstruments.map((i) => ({
      ...i,
      rate: priceAt(fx.get(i.symbol) ?? [], todayIso()),
      override: overrides.find((o) => o.instrumentId === i.id)?.price ?? null,
    }));
  });
