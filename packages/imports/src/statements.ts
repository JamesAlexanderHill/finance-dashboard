import { and, eq, inArray, sql } from 'drizzle-orm';
import { JOB_TYPES, type ImportSummary, type StatementStage } from '@finance/contracts';
import {
  balanceObservations,
  financialAccounts,
  importResults,
  institutions,
  sourceFiles,
  sourceRecords,
  statements,
  transactions,
  transactionSources,
  type Database,
  type Executor,
} from '@finance/db';
import {
  UnsupportedStatementError,
  withOrdinals,
  type ParsedStatement,
  FX_EXCHANGE,
  fxInstrument,
  REPORTING_CURRENCY,
} from '@finance/domain';
import { planMatches } from '@finance/ledger';
import { lockWorkspace, refreshProjection, refreshTransactionSupport } from '@finance/ledger/store';
import { parseStatement } from '@finance/parsers';
import { sha256Hex } from '@finance/shared/node';
import { findOrCreateInstrument, recordPriceObservations } from './prices';
import { appendProgress, enqueueJob, type Job } from './queue';
import { assertNoLiveDuplicate, retireFailedStatements } from './source-files';
import { sourceFileKey, type ObjectStorage } from './storage';

export interface UploadInput {
  workspaceId: string;
  userId: string;
  fileName: string;
  contentType: string;
  bytes: Uint8Array;
}

/**
 * Stores the binary privately, records the source file and statement, and queues the import job.
 * Rejects a byte-identical file that is already live in the workspace; a failed statement with the
 * same bytes is soft-deleted and replaced instead.
 */
export async function createStatementUpload(db: Database, storage: ObjectStorage, input: UploadInput) {
  const checksum = sha256Hex(input.bytes);
  await assertNoLiveDuplicate(db, input.workspaceId, checksum, 'imported');

  const sourceFileId = crypto.randomUUID();
  const objectKey = sourceFileKey(input.workspaceId, sourceFileId);
  await storage.put(objectKey, input.bytes, input.contentType, checksum);

  return db.transaction(async (tx) => {
    await retireFailedStatements(tx, input.workspaceId, checksum, input.userId);
    await tx.insert(sourceFiles).values({
      id: sourceFileId,
      workspaceId: input.workspaceId,
      kind: 'statement',
      originalName: input.fileName,
      contentType: input.contentType,
      sizeBytes: input.bytes.byteLength,
      checksumSha256: checksum,
      objectKey,
      uploadedBy: input.userId,
    });
    const [statement] = await tx.insert(statements).values({ workspaceId: input.workspaceId, sourceFileId, status: 'queued' }).returning();
    const job = await enqueueJob(tx, {
      workspaceId: input.workspaceId,
      type: JOB_TYPES.statementImport,
      payload: { statementId: statement!.id },
      idempotencyKey: `statement-import:${statement!.id}`,
    });
    await appendProgress(tx, job, 'queued', `Queued ${input.fileName}`);
    return { statement: statement!, job };
  });
}

async function setStage(db: Executor, job: Job, statementId: string, stage: StatementStage, message?: string, data?: unknown) {
  await db.update(statements).set({ status: stage }).where(eq(statements.id, statementId));
  await appendProgress(db, job, stage, message, data);
}

/**
 * Runs a statement import job: parse → normalise → stage → reconcile → post events.
 * All financial effects commit in one DB transaction, so a crash or retry never leaves partial state.
 * Unsupported files fail permanently (no retry); other errors propagate for the queue to retry.
 */
export async function runStatementImport(db: Database, storage: ObjectStorage, job: Job, statementId: string) {
  const [row] = await db
    .select({ statement: statements, file: sourceFiles })
    .from(statements)
    .innerJoin(sourceFiles, eq(sourceFiles.id, statements.sourceFileId))
    // The workspace comes from the job row, never from the payload.
    .where(and(eq(statements.id, statementId), eq(statements.workspaceId, job.workspaceId)));
  if (!row) throw new Error(`Statement ${statementId} not found in workspace`);
  if (row.statement.status === 'completed') {
    await appendProgress(db, job, 'completed', 'Already imported');
    return;
  }

  await setStage(db, job, statementId, 'parsing', `Parsing ${row.file.originalName}`);
  let parsed: ParsedStatement;
  try {
    parsed = await parseStatement(await storage.getBytes(row.file.objectKey), row.file.contentType);
  } catch (err) {
    if (err instanceof UnsupportedStatementError) {
      await db.update(statements).set({ error: err.message }).where(eq(statements.id, statementId));
      await setStage(db, job, statementId, 'failed', err.message);
      return;
    }
    throw err;
  }

  const rowCount = parsed.accounts.reduce((n, a) => n + a.rows.length, 0);
  await setStage(db, job, statementId, 'normalising', `Read ${rowCount} rows from ${parsed.accounts.length} account(s)`);
  await setStage(db, job, statementId, 'staging', 'Staging rows and reconciling');

  const summary = await db.transaction(async (tx) => {
    await lockWorkspace(tx, job.workspaceId);
    const [current] = await tx.select({ status: statements.status }).from(statements).where(eq(statements.id, statementId));
    if (current?.status === 'completed') return null;
    return commitParsedStatement(tx, job.workspaceId, row.file.id, statementId, parsed);
  });

  if (!summary) {
    await appendProgress(db, job, 'completed', 'Already imported');
    return;
  }
  await db.insert(importResults).values({ workspaceId: job.workspaceId, statementId, sourceFileId: row.file.id, jobId: job.id, summary });
  await appendProgress(
    db,
    job,
    'reconciling',
    `${summary.created} new, ${summary.linked} matched (${summary.restored} restored), ${summary.transfersMatched} transfers linked`,
    summary,
  );
  await appendProgress(db, job, 'posting-events', 'Events rebuilt');
  await appendProgress(db, job, 'completed', `Imported ${summary.rows} rows`, summary);
}

/** Routes rows to accounts, records source rows, matches canonical transactions and rebuilds events. */
export async function commitParsedStatement(
  tx: Executor,
  workspaceId: string,
  sourceFileId: string,
  statementId: string,
  parsed: ParsedStatement,
): Promise<ImportSummary> {
  const institution = await findOrCreateInstitution(tx, workspaceId, parsed.institutionName, parsed.provider);
  const summary: ImportSummary = {
    rows: 0,
    created: 0,
    linked: 0,
    restored: 0,
    transfersMatched: 0,
    prices: 0,
    accounts: [],
    warnings: [...parsed.warnings],
  };

  const routes = [];
  for (const section of parsed.accounts) {
    const { account, created } = await findOrCreateAccount(tx, workspaceId, institution.id, section);
    // A merged account's rows belong to the account it was merged into.
    const target = account.mergedIntoId ? await accountById(tx, account.mergedIntoId) : account;
    routes.push({ section, account, target });
    summary.accounts.push({ id: target.id, name: target.name, created });
  }
  // Ordinals count identical rows across the whole file, so two sections routed to one account never share a fingerprint.
  const fingerprinted = new Map(
    withOrdinals(routes.flatMap(({ section, target }) => section.rows.map((r) => ({ ...r, accountId: target.id })))).map((r) => [
      r.rowIndex,
      r,
    ]),
  );

  for (const { section, account, target } of routes) {
    for (const balance of [
      section.openingBalance && { kind: 'opening' as const, ...section.openingBalance },
      section.closingBalance && { kind: 'closing' as const, ...section.closingBalance },
    ]) {
      if (!balance) continue;
      await tx.insert(balanceObservations).values({
        workspaceId,
        accountId: account.id,
        observedOn: balance.on,
        kind: balance.kind,
        balance: balance.balance,
        source: 'statement',
        sourceFileId,
      });
    }

    const rows = section.rows.map((r) => fingerprinted.get(r.rowIndex)!);
    if (rows.length === 0) continue;
    summary.rows += rows.length;

    const records = await tx
      .insert(sourceRecords)
      .values(
        rows.map((r) => ({
          workspaceId,
          sourceFileId,
          rowIndex: r.rowIndex,
          accountId: account.id,
          postedOn: r.postedOn,
          description: r.description,
          amount: r.amount,
          runningBalance: r.runningBalance ?? null,
          ordinal: r.ordinal,
          fingerprint: r.fingerprint,
          raw: r.raw,
        })),
      )
      .returning({ id: sourceRecords.id, rowIndex: sourceRecords.rowIndex });
    const recordIdByRow = new Map(records.map((r) => [r.rowIndex, r.id]));

    const existing = await tx
      .select({ id: transactions.id, fingerprint: transactions.fingerprint, supported: transactions.isSourceSupported })
      .from(transactions)
      .where(
        and(
          eq(transactions.workspaceId, workspaceId),
          inArray(
            transactions.fingerprint,
            rows.map((r) => r.fingerprint),
          ),
        ),
      );
    const plan = planMatches(rows, new Map(existing.map((e) => [e.fingerprint, e.id])));
    const unsupported = new Set(existing.filter((e) => !e.supported).map((e) => e.id));

    const byRow = new Map(rows.map((r) => [r.rowIndex, r]));
    const createdTx = plan.created.length
      ? await tx
          .insert(transactions)
          .values(
            plan.created.map((rowIndex) => {
              const r = byRow.get(rowIndex)!;
              return {
                workspaceId,
                accountId: target.id,
                postedOn: r.postedOn,
                description: r.description,
                amount: r.amount,
                commodity: section.commodity,
                providerId: r.providerId ?? null,
                providerGroupRef: r.groupRef ?? null,
                role: r.role ?? 'principal',
                isTransferHint: r.transferHint ?? false,
                counterpartDate: r.counterpartDate ?? null,
                fingerprint: r.fingerprint,
              };
            }),
          )
          .returning({ id: transactions.id, fingerprint: transactions.fingerprint })
      : [];
    const createdByFingerprint = new Map(createdTx.map((t) => [t.fingerprint, t.id]));

    const links = [
      ...plan.linked.map((l) => ({ transactionId: l.transactionId, sourceRecordId: recordIdByRow.get(l.rowIndex)! })),
      ...plan.created.map((rowIndex) => ({
        transactionId: createdByFingerprint.get(byRow.get(rowIndex)!.fingerprint)!,
        sourceRecordId: recordIdByRow.get(rowIndex)!,
      })),
    ];
    if (links.length) await tx.insert(transactionSources).values(links);

    const linkedIds = plan.linked.map((l) => l.transactionId);
    await refreshTransactionSupport(tx, workspaceId, linkedIds);
    // A newer parser may know more about a row than the one that created its transaction.
    for (const l of plan.linked) {
      const r = byRow.get(l.rowIndex)!;
      if (!r.groupRef && !r.transferHint && !r.role && !r.counterpartDate) continue;
      await tx
        .update(transactions)
        .set({
          ...(r.groupRef ? { providerGroupRef: r.groupRef } : {}),
          ...(r.role ? { role: r.role } : {}),
          ...(r.transferHint ? { isTransferHint: true } : {}),
          ...(r.counterpartDate ? { counterpartDate: r.counterpartDate } : {}),
        })
        .where(eq(transactions.id, l.transactionId));
    }
    summary.created += plan.created.length;
    summary.linked += plan.linked.length;
    summary.restored += linkedIds.filter((id) => unsupported.has(id)).length;
  }

  // Every foreign currency held needs an FX rate series to be valued in AUD.
  const currencies = new Set(parsed.accounts.map((a) => a.instrument?.currency ?? a.commodity).filter((c) => c !== REPORTING_CURRENCY));
  for (const currency of currencies) await findOrCreateInstrument(tx, workspaceId, fxInstrument(currency));

  if (parsed.prices?.length) {
    const observations = [];
    for (const p of parsed.prices) {
      const instrument = await findOrCreateInstrument(
        tx,
        workspaceId,
        p.exchange === FX_EXCHANGE
          ? fxInstrument(p.symbol)
          : { symbol: p.symbol, exchange: p.exchange, name: p.symbol, currency: p.currency },
      );
      observations.push({
        instrumentId: instrument.id,
        observedOn: p.on,
        price: p.price,
        currency: p.currency,
        priceType: p.priceType,
        source: 'statement' as const,
        sourceFileId,
        sourceRow: p.sourceRow ?? null,
      });
    }
    const recorded = await recordPriceObservations(tx, workspaceId, observations);
    summary.prices = recorded.inserted;
    if (recorded.conflicts) summary.warnings.push(`${recorded.conflicts} price(s) conflict with existing observations and need review`);
  }

  summary.transfersMatched = (await refreshProjection(tx, workspaceId)).matched;
  await tx
    .update(statements)
    .set({
      status: 'completed',
      institutionId: institution.id,
      parserId: parsed.parserId,
      parserVersion: parsed.parserVersion,
      periodStart: parsed.periodStart,
      periodEnd: parsed.periodEnd,
      error: null,
      completedAt: sql`now()`,
    })
    .where(eq(statements.id, statementId));
  return summary;
}

async function findOrCreateInstitution(tx: Executor, workspaceId: string, name: string, provider: string) {
  const [existing] = await tx
    .select()
    .from(institutions)
    .where(and(eq(institutions.workspaceId, workspaceId), eq(institutions.provider, provider)))
    .limit(1);
  if (existing) return existing;
  const [created] = await tx.insert(institutions).values({ workspaceId, name, provider }).returning();
  return created!;
}

async function accountById(tx: Executor, id: string) {
  const [account] = await tx.select().from(financialAccounts).where(eq(financialAccounts.id, id));
  if (!account) throw new Error(`Account ${id} not found`);
  return account;
}

/** Unknown identifiers under a known institution become unconfirmed accounts (ADR 0011). */
async function findOrCreateAccount(tx: Executor, workspaceId: string, institutionId: string, section: ParsedStatement['accounts'][number]) {
  const [existing] = await tx
    .select()
    .from(financialAccounts)
    .where(and(eq(financialAccounts.institutionId, institutionId), eq(financialAccounts.identifier, section.identifier)));
  if (existing) return { account: existing, created: false };
  const [account] = await tx
    .insert(financialAccounts)
    .values({
      workspaceId,
      institutionId,
      name: section.name,
      accountType: section.accountType,
      classification: section.classification,
      commodity: section.commodity,
      commodityKind: section.instrument ? 'instrument' : 'currency',
      instrumentId: section.instrument ? (await findOrCreateInstrument(tx, workspaceId, section.instrument)).id : null,
      identifier: section.identifier,
      maskedIdentifier: section.maskedIdentifier,
      status: 'unconfirmed',
    })
    .returning();
  return { account: account!, created: true };
}

/**
 * Soft-deletes or restores a statement's source file. Its rows stop (or resume) supporting their
 * transactions; transactions still supported by another live file stay active. Restoring is refused
 * while an identical file is live.
 */
export async function setStatementDeleted(db: Database, workspaceId: string, statementId: string, deleted: boolean, userId: string) {
  return db.transaction(async (tx) => {
    await lockWorkspace(tx, workspaceId);
    const [row] = await tx
      .select({ sourceFileId: statements.sourceFileId, checksum: sourceFiles.checksumSha256 })
      .from(statements)
      .innerJoin(sourceFiles, eq(sourceFiles.id, statements.sourceFileId))
      .where(and(eq(statements.id, statementId), eq(statements.workspaceId, workspaceId)));
    if (!row) return false;
    if (!deleted) await assertNoLiveDuplicate(tx, workspaceId, row.checksum, 'imported', row.sourceFileId);
    await tx
      .update(sourceFiles)
      .set(deleted ? { deletedAt: sql`now()`, deletedBy: userId } : { deletedAt: null, deletedBy: null })
      .where(eq(sourceFiles.id, row.sourceFileId));
    const affected = await tx
      .selectDistinct({ id: transactionSources.transactionId })
      .from(transactionSources)
      .innerJoin(sourceRecords, eq(sourceRecords.id, transactionSources.sourceRecordId))
      .where(eq(sourceRecords.sourceFileId, row.sourceFileId));
    await refreshTransactionSupport(
      tx,
      workspaceId,
      affected.map((a) => a.id),
    );
    await refreshProjection(tx, workspaceId);
    return true;
  });
}
