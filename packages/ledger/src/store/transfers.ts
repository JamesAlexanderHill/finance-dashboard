import { sql } from 'drizzle-orm';
import { reconciliationDecisions, type Executor } from '@finance/db';
import { planTransferMatches, type TransferCandidate } from '../transfers';

/**
 * Active principal transactions that could still be auto-matched: not already grouped with another
 * active transaction by a provider reference, and never the subject of a link decision (so a user's
 * unlink or manual link is never overridden by the matcher).
 */
export async function transferCandidates(tx: Executor, workspaceId: string): Promise<TransferCandidate[]> {
  const rows = await tx.execute<{
    id: string;
    account_id: string;
    posted_on: string;
    amount: string;
    commodity: string;
    counterpart_date: string | null;
  }>(sql`
    select t.id, t.account_id, t.posted_on::text, t.amount::text, t.commodity, t.counterpart_date::text
    from transactions t
    where t.workspace_id = ${workspaceId}
      and t.is_source_supported and not t.is_suppressed
      and t.role = 'principal'
      and not exists (select 1 from reconciliation_decisions d where d.transaction_id = t.id and d.kind = 'link')
      and (t.provider_group_ref is null or not exists (
        select 1 from transactions o
        where o.workspace_id = t.workspace_id and o.provider_group_ref = t.provider_group_ref and o.id <> t.id
          and o.is_source_supported and not o.is_suppressed))
  `);
  return [...rows].map((r) => ({
    id: r.id,
    accountId: r.account_id,
    postedOn: r.posted_on,
    amount: r.amount,
    commodity: r.commodity,
    counterpartDate: r.counterpart_date,
  }));
}

/**
 * Links unique transfer pairs with system link decisions (ADR 0012). Persisting the match keeps it
 * stable when later imports add more candidates; ambiguous candidates are left for review.
 */
export async function autoMatchTransfers(tx: Executor, workspaceId: string) {
  const { pairs } = planTransferMatches(await transferCandidates(tx, workspaceId));
  if (pairs.length === 0) return 0;
  await tx.insert(reconciliationDecisions).values(
    pairs.flatMap(([a, b]) => {
      const groupId = crypto.randomUUID();
      return [a, b].map((t) => ({
        workspaceId,
        transactionId: t.id,
        kind: 'link' as const,
        payload: { groupId, rule: 'auto-transfer' },
        actor: 'system' as const,
      }));
    }),
  );
  return pairs.length;
}
