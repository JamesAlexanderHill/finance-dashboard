import { and, asc, count, eq, inArray, sql } from 'drizzle-orm';
import { financialAccounts, sourceRecords, transactions, transactionSources, type Database, type Executor } from '@finance/db';
import { withOrdinals } from '@finance/domain';
import { todayIso, type IsoDate } from '@finance/shared';
import { lockWorkspace, refreshProjection, refreshTransactionSupport } from '@finance/ledger/store';

export class AccountMergeError extends Error {}

/**
 * Merges an unconfirmed account into another account of the same institution and commodity
 * (ADR 0011). Its statements keep naming it, but their rows are re-fingerprinted against the target:
 * a transaction moves whole (keeping its ID and decisions) unless the target already has it, in which
 * case the row joins the target's transaction. Undone by `unmergeAccount`.
 */
export async function mergeAccount(db: Database, workspaceId: string, accountId: string, intoId: string, userId: string) {
  return db.transaction(async (tx) => {
    await lockWorkspace(tx, workspaceId);
    const rows = await tx
      .select()
      .from(financialAccounts)
      .where(and(eq(financialAccounts.workspaceId, workspaceId), inArray(financialAccounts.id, [accountId, intoId])));
    const account = rows.find((a) => a.id === accountId);
    const into = rows.find((a) => a.id === intoId);
    if (!account || !into) throw new AccountMergeError('Account not found');
    if (account.id === into.id) throw new AccountMergeError('An account cannot be merged into itself');
    if (account.status !== 'unconfirmed') throw new AccountMergeError('Only unconfirmed accounts can be merged');
    if (account.mergedIntoId) throw new AccountMergeError(`${account.name} is already merged`);
    if (into.mergedIntoId) throw new AccountMergeError(`${into.name} is merged into another account`);
    if (account.closedOn || into.closedOn) throw new AccountMergeError('Archived accounts cannot be merged; unarchive first');
    if (account.institutionId !== into.institutionId) throw new AccountMergeError('Both accounts must belong to the same institution');
    if (account.commodity !== into.commodity) {
      throw new AccountMergeError(`${account.name} holds ${account.commodity} but ${into.name} holds ${into.commodity}`);
    }
    const [mergedIn] = await tx.select({ n: count() }).from(financialAccounts).where(eq(financialAccounts.mergedIntoId, account.id));
    if (mergedIn!.n > 0) throw new AccountMergeError(`Other accounts are merged into ${account.name}`);

    await tx
      .update(financialAccounts)
      .set({ mergedIntoId: into.id, mergedAt: sql`now()`, mergedBy: userId })
      .where(eq(financialAccounts.id, account.id));
    await reassignSourceRecords(tx, workspaceId, account.id);
    await refreshProjection(tx, workspaceId);
  });
}

/** Reverses a merge: the account's rows return to it, restoring its original transactions and their decisions. */
export async function unmergeAccount(db: Database, workspaceId: string, accountId: string) {
  return db.transaction(async (tx) => {
    await lockWorkspace(tx, workspaceId);
    const [account] = await tx
      .select()
      .from(financialAccounts)
      .where(and(eq(financialAccounts.workspaceId, workspaceId), eq(financialAccounts.id, accountId)));
    if (!account) throw new AccountMergeError('Account not found');
    if (!account.mergedIntoId) throw new AccountMergeError(`${account.name} is not merged`);
    await tx
      .update(financialAccounts)
      .set({ mergedIntoId: null, mergedAt: null, mergedBy: null })
      .where(eq(financialAccounts.id, account.id));
    await reassignSourceRecords(tx, workspaceId, account.id);
    await refreshProjection(tx, workspaceId);
  });
}

export class AccountArchiveError extends Error {}

/**
 * The latest date the account has activity that counts: a live transaction, or a balance from a live
 * statement or entered by hand, including those of accounts merged into it. Null when it has none.
 */
export async function latestAccountActivity(tx: Executor, workspaceId: string, accountId: string): Promise<IsoDate | null> {
  const [row] = await tx.execute<{ on: string | null }>(sql`
    select greatest(
      (select max(t.posted_on) from transactions t
        where t.workspace_id = ${workspaceId} and t.account_id = ${accountId} and t.is_source_supported and not t.is_suppressed),
      (select max(bo.observed_on) from balance_observations bo
        join financial_accounts fa on fa.id = bo.account_id
        left join source_files sf on sf.id = bo.source_file_id
        where bo.workspace_id = ${workspaceId} and ${accountId} in (fa.id, fa.merged_into_id)
          and (bo.source_file_id is null or sf.deleted_at is null))
    )::text as on`);
  return row?.on ?? null;
}

/**
 * Archives an account by closing it on `closedOn` (feature 02): valuation counts it up to that date and
 * excludes it afterwards. The date cannot precede the account's latest activity, nor be in the future.
 */
export async function closeAccount(db: Database, workspaceId: string, accountId: string, closedOn: IsoDate) {
  return db.transaction(async (tx) => {
    await lockWorkspace(tx, workspaceId);
    const [account] = await tx
      .select()
      .from(financialAccounts)
      .where(and(eq(financialAccounts.workspaceId, workspaceId), eq(financialAccounts.id, accountId)));
    if (!account) throw new AccountArchiveError('Account not found');
    if (account.mergedIntoId) throw new AccountArchiveError(`${account.name} is merged into another account`);
    if (account.closedOn) throw new AccountArchiveError(`${account.name} is already archived`);
    if (closedOn > todayIso()) throw new AccountArchiveError('The closing date cannot be in the future');
    const latest = await latestAccountActivity(tx, workspaceId, accountId);
    if (latest && closedOn < latest) {
      throw new AccountArchiveError(`${account.name} has activity on ${latest}; it cannot close before then`);
    }
    await tx
      .update(financialAccounts)
      .set({ closedOn, archivedAt: sql`now()` })
      .where(eq(financialAccounts.id, accountId));
  });
}

/** Unarchives an account: it reopens and counts toward valuation on every date again. */
export async function reopenAccount(db: Database, workspaceId: string, accountId: string) {
  const [account] = await db
    .update(financialAccounts)
    .set({ closedOn: null, archivedAt: null })
    .where(and(eq(financialAccounts.workspaceId, workspaceId), eq(financialAccounts.id, accountId)))
    .returning({ id: financialAccounts.id });
  if (!account) throw new AccountArchiveError('Account not found');
}

/**
 * Re-fingerprints every source row in the files that name `accountId` against each row's effective
 * account (the account it is merged into, or itself), and moves rows whose fingerprint changed to
 * the transaction with the new fingerprint. Ordinals are recounted per file, so rows of other
 * accounts in those files are included.
 */
async function reassignSourceRecords(tx: Executor, workspaceId: string, accountId: string) {
  const files = tx.selectDistinct({ id: sourceRecords.sourceFileId }).from(sourceRecords).where(eq(sourceRecords.accountId, accountId));
  const records = await tx
    .select({
      id: sourceRecords.id,
      sourceFileId: sourceRecords.sourceFileId,
      rowIndex: sourceRecords.rowIndex,
      postedOn: sourceRecords.postedOn,
      description: sourceRecords.description,
      amount: sourceRecords.amount,
      fingerprint: sourceRecords.fingerprint,
      effectiveAccountId: sql<string>`coalesce(${financialAccounts.mergedIntoId}, ${financialAccounts.id})`,
      transactionId: transactions.id,
      providerId: transactions.providerId,
    })
    .from(sourceRecords)
    .innerJoin(financialAccounts, eq(financialAccounts.id, sourceRecords.accountId))
    .innerJoin(transactionSources, eq(transactionSources.sourceRecordId, sourceRecords.id))
    .innerJoin(transactions, eq(transactions.id, transactionSources.transactionId))
    .where(and(eq(sourceRecords.workspaceId, workspaceId), inArray(sourceRecords.sourceFileId, files)))
    .orderBy(asc(sourceRecords.sourceFileId), asc(sourceRecords.rowIndex));

  const previous = new Map(records.map((r) => [r.id, r.fingerprint]));
  const changed = [...Map.groupBy(records, (r) => r.sourceFileId).values()]
    .flatMap((rows) => withOrdinals(rows.map((r) => ({ ...r, accountId: r.effectiveAccountId, providerId: r.providerId ?? undefined }))))
    .filter((r) => r.fingerprint !== previous.get(r.id));
  if (changed.length === 0) return;

  // Transactions that own the new fingerprints, kept current as transactions move.
  const owners = new Map(
    (
      await tx
        .select({ id: transactions.id, fingerprint: transactions.fingerprint })
        .from(transactions)
        .where(
          and(
            eq(transactions.workspaceId, workspaceId),
            inArray(
              transactions.fingerprint,
              changed.map((r) => r.fingerprint),
            ),
          ),
        )
    ).map((t) => [t.fingerprint, t.id]),
  );
  const byTransaction = Map.groupBy(changed, (r) => r.transactionId);
  const sourceCounts = new Map(
    (
      await tx
        .select({ id: transactionSources.transactionId, n: count() })
        .from(transactionSources)
        .where(inArray(transactionSources.transactionId, [...byTransaction.keys()]))
        .groupBy(transactionSources.transactionId)
    ).map((c) => [c.id, c.n]),
  );
  const touched = new Set<string>();
  const setRecord = (r: (typeof changed)[number]) =>
    tx.update(sourceRecords).set({ fingerprint: r.fingerprint, ordinal: r.ordinal }).where(eq(sourceRecords.id, r.id));

  for (const [transactionId, rows] of byTransaction) {
    const fingerprints = new Set(rows.map((r) => r.fingerprint));
    const [fingerprint] = fingerprints;
    if (fingerprints.size === 1 && sourceCounts.get(transactionId) === rows.length && !owners.has(fingerprint!)) {
      // Every row of the transaction moves to the same place: move it whole, keeping its ID and decisions.
      await tx
        .update(transactions)
        .set({ accountId: rows[0]!.accountId, fingerprint, updatedAt: sql`now()` })
        .where(eq(transactions.id, transactionId));
      for (const [f, id] of owners) if (id === transactionId) owners.delete(f);
      owners.set(fingerprint!, transactionId);
      for (const r of rows) await setRecord(r);
      touched.add(transactionId);
      continue;
    }
    const [current] = await tx.select().from(transactions).where(eq(transactions.id, transactionId));
    for (const r of rows) {
      let owner = owners.get(r.fingerprint);
      if (!owner) {
        const [created] = await tx
          .insert(transactions)
          .values({
            workspaceId,
            accountId: r.accountId,
            postedOn: r.postedOn,
            description: r.description,
            amount: r.amount,
            commodity: current!.commodity,
            providerId: current!.providerId,
            providerGroupRef: current!.providerGroupRef,
            role: current!.role,
            isTransferHint: current!.isTransferHint,
            counterpartDate: current!.counterpartDate,
            fingerprint: r.fingerprint,
          })
          .returning({ id: transactions.id });
        owner = created!.id;
        owners.set(r.fingerprint, owner);
      }
      await tx.update(transactionSources).set({ transactionId: owner }).where(eq(transactionSources.sourceRecordId, r.id));
      await setRecord(r);
      touched.add(owner);
    }
    touched.add(transactionId);
  }
  await refreshTransactionSupport(tx, workspaceId, [...touched]);
}
