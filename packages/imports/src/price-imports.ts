import { and, eq, sql } from 'drizzle-orm';
import { JOB_TYPES, type PriceCsvMappingInput, type PriceImportSummary } from '@finance/contracts';
import { importResults, instrumentAliases, instruments, jobs, sourceFiles, type Database, type Executor } from '@finance/db';
import { mapPriceRows, parseCsv, PRICE_CSV_MAPPING_VERSION, type ResolvedInstrument } from '@finance/parsers';
import { sha256Hex } from '@finance/shared/node';
import { recordPriceObservations } from './prices';
import { appendProgress, enqueueJob, type Job } from './queue';
import { assertNoLiveDuplicate } from './source-files';
import { sourceFileKey, type ObjectStorage } from './storage';

export class PriceImportError extends Error {}

const PREVIEW_ROWS = 8;
const MAX_REPORTED_ERRORS = 200;

/** Stores a price CSV privately as a `price_import` source file. Importing waits for a column mapping. */
export async function createPriceImportUpload(
  db: Database,
  storage: ObjectStorage,
  input: { workspaceId: string; userId: string; fileName: string; bytes: Uint8Array },
) {
  const checksum = sha256Hex(input.bytes);
  await assertNoLiveDuplicate(db, input.workspaceId, checksum);

  const id = crypto.randomUUID();
  const objectKey = sourceFileKey(input.workspaceId, id);
  await storage.put(objectKey, input.bytes, 'text/csv', checksum);
  await db.insert(sourceFiles).values({
    id,
    workspaceId: input.workspaceId,
    kind: 'price_import',
    originalName: input.fileName,
    contentType: 'text/csv',
    sizeBytes: input.bytes.byteLength,
    checksumSha256: checksum,
    objectKey,
    uploadedBy: input.userId,
  });
  return { sourceFileId: id };
}

async function ownedPriceFile(db: Executor, workspaceId: string, sourceFileId: string) {
  const [file] = await db
    .select()
    .from(sourceFiles)
    .where(and(eq(sourceFiles.id, sourceFileId), eq(sourceFiles.workspaceId, workspaceId), eq(sourceFiles.kind, 'price_import')));
  if (!file) throw new PriceImportError('Price file not found');
  return file;
}

/** Header and first rows of an uploaded price CSV, for choosing the column mapping. */
export async function previewPriceCsv(db: Database, storage: ObjectStorage, workspaceId: string, sourceFileId: string) {
  const file = await ownedPriceFile(db, workspaceId, sourceFileId);
  const rows = parseCsv(new TextDecoder().decode(await storage.getBytes(file.objectKey)));
  return {
    fileName: file.originalName,
    header: rows[0] ?? [],
    sample: rows.slice(1, 1 + PREVIEW_ROWS),
    rowCount: Math.max(0, rows.length - 1),
  };
}

/** Queues the import of an uploaded price CSV with the chosen mapping. */
export async function startPriceImport(db: Database, workspaceId: string, sourceFileId: string, mapping: PriceCsvMappingInput) {
  await ownedPriceFile(db, workspaceId, sourceFileId);
  if (mapping.instrumentId) {
    const [i] = await db
      .select({ id: instruments.id })
      .from(instruments)
      .where(and(eq(instruments.id, mapping.instrumentId), eq(instruments.workspaceId, workspaceId)));
    if (!i) throw new PriceImportError('Instrument not found');
  }
  return db.transaction(async (tx) => {
    const job = await enqueueJob(tx, {
      workspaceId,
      type: JOB_TYPES.priceImport,
      payload: { sourceFileId, mapping, mappingVersion: PRICE_CSV_MAPPING_VERSION },
      // One import per file: re-importing the same file would only duplicate its own observations.
      idempotencyKey: `price-import:${sourceFileId}`,
    });
    if (job.status === 'queued' && job.attempts === 0) await appendProgress(tx, job, 'queued', 'Queued price import');
    return job;
  });
}

/**
 * Resolves an instrument named in a CSV: its symbol, `EXCHANGE:SYMBOL`, the `SYMBOL.AX` form for
 * ASX listings, a currency pair such as `USDAUD` for FX rates, or a recorded alias. Ambiguous symbols
 * (listed on several exchanges) do not resolve unless an alias names one; an alias is the user's
 * explicit choice, so it wins over every derived name. Inverse pairs such as `AUDUSD` are not inverted.
 */
export async function instrumentResolver(db: Executor, workspaceId: string) {
  const [all, aliases] = await Promise.all([
    db.select().from(instruments).where(eq(instruments.workspaceId, workspaceId)),
    db.select().from(instrumentAliases).where(eq(instrumentAliases.workspaceId, workspaceId)),
  ]);
  const names = new Map<string, ResolvedInstrument | null>();
  const add = (name: string, i: ResolvedInstrument) => {
    const key = name.toUpperCase();
    const existing = names.get(key);
    names.set(key, existing === undefined || existing?.id === i.id ? i : null);
  };
  for (const i of all) {
    const resolved = { id: i.id, currency: i.currency };
    add(i.symbol, resolved);
    add(`${i.exchange}:${i.symbol}`, resolved);
    if (i.exchange === 'XASX') add(`${i.symbol}.AX`, resolved);
    // FX rates: USDAUD, USD/AUD and USD.AUD all mean AUD per 1 USD.
    if (i.exchange === 'FX') for (const sep of ['', '/', '.']) add(`${i.symbol}${sep}${i.currency}`, resolved);
  }
  for (const a of aliases) {
    const i = all.find((x) => x.id === a.instrumentId);
    if (i) names.set(a.alias.toUpperCase(), { id: i.id, currency: i.currency });
  }
  return {
    resolve: (value: string) => names.get(value.toUpperCase()) ?? null,
    byId: (id: string) => {
      const i = all.find((x) => x.id === id);
      return i ? { id: i.id, currency: i.currency } : null;
    },
  };
}

/**
 * Instrument names in a CSV column that do not resolve, with how many rows use each, so the user can
 * map them to instruments (as aliases) before importing.
 */
export async function unresolvedInstrumentNames(
  db: Database,
  storage: ObjectStorage,
  workspaceId: string,
  sourceFileId: string,
  column: string,
): Promise<Array<{ name: string; rows: number }>> {
  const file = await ownedPriceFile(db, workspaceId, sourceFileId);
  const [header, ...body] = parseCsv(new TextDecoder().decode(await storage.getBytes(file.objectKey)));
  const index = header?.findIndex((h) => h.trim() === column) ?? -1;
  if (index < 0) return [];
  const { resolve } = await instrumentResolver(db, workspaceId);
  const counts = new Map<string, number>();
  for (const row of body) {
    const name = (row[index] ?? '').trim();
    if (name && !resolve(name)) counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts].map(([name, rows]) => ({ name, rows })).sort((a, b) => a.name.localeCompare(b.name));
}

export async function listInstrumentAliases(db: Executor, workspaceId: string) {
  return db
    .select({ id: instrumentAliases.id, alias: instrumentAliases.alias, instrumentId: instrumentAliases.instrumentId })
    .from(instrumentAliases)
    .where(eq(instrumentAliases.workspaceId, workspaceId))
    .orderBy(instrumentAliases.alias);
}

/** Records another name for an instrument. A name already aliased (in any letter case) is moved to this instrument. */
export async function setInstrumentAlias(db: Database, workspaceId: string, instrumentId: string, alias: string) {
  const name = alias.trim();
  if (!name) throw new PriceImportError('Enter a name');
  const [instrument] = await db
    .select({ id: instruments.id })
    .from(instruments)
    .where(and(eq(instruments.id, instrumentId), eq(instruments.workspaceId, workspaceId)));
  if (!instrument) throw new PriceImportError('Instrument not found');
  return db.transaction(async (tx) => {
    await tx
      .delete(instrumentAliases)
      .where(and(eq(instrumentAliases.workspaceId, workspaceId), sql`upper(${instrumentAliases.alias}) = ${name.toUpperCase()}`));
    const [row] = await tx.insert(instrumentAliases).values({ workspaceId, instrumentId, alias: name }).returning();
    return row!;
  });
}

export async function removeInstrumentAlias(db: Executor, workspaceId: string, aliasId: string) {
  await db.delete(instrumentAliases).where(and(eq(instrumentAliases.id, aliasId), eq(instrumentAliases.workspaceId, workspaceId)));
}

/** Runs a price import job: validate every row, then record valid observations atomically. */
export async function runPriceImport(
  db: Database,
  storage: ObjectStorage,
  job: Job,
  payload: { sourceFileId: string; mapping: PriceCsvMappingInput; mappingVersion: string },
) {
  const file = await ownedPriceFile(db, job.workspaceId, payload.sourceFileId);
  const [done] = await db.select({ id: importResults.id }).from(importResults).where(eq(importResults.jobId, job.id));
  if (done) {
    await appendProgress(db, job, 'completed', 'Already imported');
    return;
  }

  await appendProgress(db, job, 'parsing', `Reading ${file.originalName}`);
  const rows = parseCsv(new TextDecoder().decode(await storage.getBytes(file.objectKey)));
  const resolver = await instrumentResolver(db, job.workspaceId);
  const fixed = payload.mapping.instrumentId ? resolver.byId(payload.mapping.instrumentId) : null;
  const { prices, errors } = mapPriceRows(rows, payload.mapping, resolver.resolve, fixed);
  await appendProgress(db, job, 'staging', `${prices.length} valid rows, ${errors.length} rejected`);

  const summary = await db.transaction(async (tx) => {
    const recorded = await recordPriceObservations(
      tx,
      job.workspaceId,
      prices.map((p) => ({
        instrumentId: p.instrumentId,
        observedOn: p.observedOn,
        price: p.price,
        currency: p.currency,
        priceType: 'daily' as const,
        source: 'csv' as const,
        sourceFileId: file.id,
        sourceRow: p.line,
      })),
    );
    const result: PriceImportSummary = {
      rows: Math.max(0, rows.length - 1),
      inserted: recorded.inserted,
      duplicates: recorded.duplicates,
      conflicts: recorded.conflicts,
      errors: errors.slice(0, MAX_REPORTED_ERRORS),
      errorCount: errors.length,
      mappingVersion: payload.mappingVersion,
    };
    await tx.insert(importResults).values({ workspaceId: job.workspaceId, sourceFileId: file.id, jobId: job.id, summary: result });
    return result;
  });

  const message = `${summary.inserted} prices recorded (${summary.duplicates} already known, ${summary.conflicts} conflicts), ${summary.errorCount} rows rejected`;
  await appendProgress(db, job, 'completed', message, summary);
}

/** The latest import job for each price file, for listing. */
export const priceImportJobs = (db: Executor, workspaceId: string) =>
  db
    .select()
    .from(jobs)
    .where(and(eq(jobs.workspaceId, workspaceId), eq(jobs.type, JOB_TYPES.priceImport)));

/** Soft-deletes or restores a price file; its observations leave or rejoin active use (nothing is removed). */
export async function setPriceFileDeleted(db: Database, workspaceId: string, sourceFileId: string, deleted: boolean, userId: string) {
  await ownedPriceFile(db, workspaceId, sourceFileId);
  await db
    .update(sourceFiles)
    .set(deleted ? { deletedAt: new Date(), deletedBy: userId } : { deletedAt: null, deletedBy: null })
    .where(eq(sourceFiles.id, sourceFileId));
}
