import { createServerFn } from '@tanstack/react-start';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { linkTransactionsInput, setTransferMarkInput, unlinkTransactionInput } from '@finance/contracts';
import { financialAccounts, getDb, transactions } from '@finance/db';
import { planTransferMatches, transferCounterparts, type TransferCandidate } from '@finance/ledger';
import { recordDecisions, transferCandidates } from '@finance/ledger/store';
import { workspaceMiddleware } from './session';
import { linkDecisions, unlinkDecisions } from './transfers.server';

export interface TransferTxView {
  id: string;
  postedOn: string;
  description: string;
  amount: string;
  commodity: string;
  accountName: string;
}

async function describe(workspaceId: string, ids: string[]): Promise<Map<string, TransferTxView>> {
  if (ids.length === 0) return new Map();
  const rows = await getDb()
    .select({
      id: transactions.id,
      postedOn: transactions.postedOn,
      description: transactions.description,
      amount: transactions.amount,
      commodity: transactions.commodity,
      accountName: financialAccounts.name,
    })
    .from(transactions)
    .innerJoin(financialAccounts, eq(financialAccounts.id, transactions.accountId))
    .where(and(eq(transactions.workspaceId, workspaceId), inArray(transactions.id, ids)));
  return new Map(rows.map((r) => [r.id, r]));
}

/**
 * The transfer review queue: unmatched transfers (with any plausible counterparts) and transactions
 * the auto-matcher could not pair because there was more than one candidate.
 */
export const getTransferReview = createServerFn({ method: 'GET' })
  .middleware([workspaceMiddleware])
  .handler(async ({ context }) => {
    const { workspaceId } = context;
    const db = getDb();

    const unmatchedRows = await db.execute<{ transaction_id: string }>(sql`
      select l.transaction_id from events e join event_legs l on l.event_id = e.id
      where e.workspace_id = ${workspaceId} and e.status = 'unmatched_transfer' and l.transaction_id is not null`);
    const unmatchedIds = [...unmatchedRows].map((r) => r.transaction_id);

    // Counterparts for unmatched transfers may already carry link history, so search all active principals.
    const active = await db.execute<{ id: string; account_id: string; posted_on: string; amount: string; commodity: string }>(sql`
      select id, account_id, posted_on::text, amount::text, commodity from transactions
      where workspace_id = ${workspaceId} and is_source_supported and not is_suppressed and role = 'principal'`);
    const all: TransferCandidate[] = [...active].map((r) => ({
      id: r.id,
      accountId: r.account_id,
      postedOn: r.posted_on,
      amount: r.amount,
      commodity: r.commodity,
    }));
    const counterparts = transferCounterparts(all);

    const { ambiguous } = planTransferMatches(await transferCandidates(db, workspaceId));
    // Show each ambiguous cluster once, from its outflow side where there is one.
    const ambiguousEntries = [...ambiguous].filter(([id, cands]) => {
      const self = all.find((t) => t.id === id);
      return self?.amount.startsWith('-') || !cands.some((c) => c.amount.startsWith('-') && ambiguous.has(c.id));
    });

    const ids = new Set<string>([...unmatchedIds, ...ambiguousEntries.flatMap(([id, c]) => [id, ...c.map((x) => x.id)])]);
    for (const id of unmatchedIds) for (const c of counterparts.get(id) ?? []) ids.add(c.id);
    const view = await describe(workspaceId, [...ids]);
    const byDate = (a: TransferTxView, b: TransferTxView) => b.postedOn.localeCompare(a.postedOn);

    return {
      unmatched: unmatchedIds
        .map((id) => ({ transaction: view.get(id)!, candidates: (counterparts.get(id) ?? []).map((c) => view.get(c.id)!) }))
        .sort((a, b) => byDate(a.transaction, b.transaction)),
      ambiguous: ambiguousEntries
        .map(([id, cands]) => ({ transaction: view.get(id)!, candidates: cands.map((c) => view.get(c.id)!) }))
        .sort((a, b) => byDate(a.transaction, b.transaction)),
    };
  });

export const linkTransactions = createServerFn({ method: 'POST' })
  .middleware([workspaceMiddleware])
  .validator(linkTransactionsInput)
  .handler(async ({ context, data }) => {
    const { workspaceId, userId } = context;
    await getDb().transaction(async (tx) =>
      recordDecisions(tx, workspaceId, await linkDecisions(tx, workspaceId, userId, data.transactionIds)),
    );
  });

export const unlinkTransaction = createServerFn({ method: 'POST' })
  .middleware([workspaceMiddleware])
  .validator(unlinkTransactionInput)
  .handler(async ({ context, data }) => {
    const { workspaceId, userId } = context;
    await getDb().transaction(async (tx) =>
      recordDecisions(tx, workspaceId, await unlinkDecisions(tx, workspaceId, userId, data.transactionId)),
    );
  });

/** Marks a lone transaction as a transfer (unmatched until linked), or overrides a source hint. */
export const setTransferMark = createServerFn({ method: 'POST' })
  .middleware([workspaceMiddleware])
  .validator(setTransferMarkInput)
  .handler(async ({ context, data }) => {
    const { workspaceId, userId } = context;
    const [t] = await getDb()
      .select({ id: transactions.id })
      .from(transactions)
      .where(and(eq(transactions.id, data.transactionId), eq(transactions.workspaceId, workspaceId)));
    if (!t) throw new Error('Transaction not found');
    await getDb().transaction((tx) =>
      recordDecisions(tx, workspaceId, [
        { workspaceId, transactionId: t.id, kind: 'transfer', payload: { isTransfer: data.isTransfer }, userId },
      ]),
    );
  });
