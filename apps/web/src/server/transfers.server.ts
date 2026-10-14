import { and, eq, inArray, sql } from 'drizzle-orm';
import { transactions, type Executor } from '@finance/db';
import type { NewDecision } from '@finance/ledger/store';

export class TransferError extends Error {}

/** Current link group of each transaction (latest link decision), keyed by transaction ID. */
export async function currentLinkGroups(tx: Executor, workspaceId: string) {
  const rows = await tx.execute<{ transaction_id: string; group_id: string | null }>(sql`
    select distinct on (transaction_id) transaction_id, payload->>'groupId' as group_id
    from reconciliation_decisions
    where workspace_id = ${workspaceId} and kind = 'link'
    order by transaction_id, seq desc
  `);
  return new Map([...rows].map((r) => [r.transaction_id, r.group_id]));
}

/** Link decisions joining the given transactions into one new group (replacing any groups they were in). */
export async function linkDecisions(tx: Executor, workspaceId: string, userId: string, ids: string[]): Promise<NewDecision[]> {
  const rows = await tx
    .select({ id: transactions.id, accountId: transactions.accountId })
    .from(transactions)
    .where(and(eq(transactions.workspaceId, workspaceId), inArray(transactions.id, ids)));
  if (rows.length !== new Set(ids).size) throw new TransferError('Transaction not found');
  if (new Set(rows.map((r) => r.accountId)).size < 2) throw new TransferError('Linked transactions must be in different accounts');

  // Members of groups being replaced are unlinked, so no group is left half-linked.
  const groups = await currentLinkGroups(tx, workspaceId);
  const replaced = new Set(ids.map((id) => groups.get(id)).filter(Boolean));
  const orphans = [...groups].filter(([id, g]) => g && replaced.has(g) && !ids.includes(id)).map(([id]) => id);

  const groupId = crypto.randomUUID();
  return [
    ...ids.map((transactionId) => ({ workspaceId, transactionId, kind: 'link' as const, payload: { groupId }, userId })),
    ...orphans.map((transactionId) => ({ workspaceId, transactionId, kind: 'link' as const, payload: { groupId: null }, userId })),
  ];
}

/** Decisions unlinking every member of the transaction's current link group. */
export async function unlinkDecisions(tx: Executor, workspaceId: string, userId: string, transactionId: string): Promise<NewDecision[]> {
  const groups = await currentLinkGroups(tx, workspaceId);
  const group = groups.get(transactionId);
  if (!group) throw new TransferError('This transaction is not linked');
  return [...groups]
    .filter(([, g]) => g === group)
    .map(([id]) => ({ workspaceId, transactionId: id, kind: 'link' as const, payload: { groupId: null }, userId }));
}
