import { and, desc, eq } from 'drizzle-orm';
import { reconciliationDecisions, transactions, type Executor } from '@finance/db';
import type { DecisionKind, SuppressionPayload } from '../decisions';
import { lockWorkspace } from './lock';
import { refreshProjection } from './refresh';

export interface NewDecision {
  workspaceId: string;
  transactionId: string;
  kind: DecisionKind;
  legKey?: string;
  payload: unknown;
  userId: string | null;
}

/** Appends a decision that supersedes the current one for the same (transaction, kind, leg). */
export async function appendDecision(tx: Executor, d: NewDecision) {
  const legKey = d.legKey ?? '';
  const [previous] = await tx
    .select({ id: reconciliationDecisions.id })
    .from(reconciliationDecisions)
    .where(
      and(
        eq(reconciliationDecisions.workspaceId, d.workspaceId),
        eq(reconciliationDecisions.transactionId, d.transactionId),
        eq(reconciliationDecisions.kind, d.kind),
        eq(reconciliationDecisions.legKey, legKey),
      ),
    )
    .orderBy(desc(reconciliationDecisions.seq))
    .limit(1);

  const [inserted] = await tx
    .insert(reconciliationDecisions)
    .values({
      workspaceId: d.workspaceId,
      transactionId: d.transactionId,
      kind: d.kind,
      legKey,
      payload: d.payload,
      supersedesId: previous?.id ?? null,
      actor: d.userId ? 'user' : 'system',
      createdBy: d.userId,
    })
    .returning();

  if (d.kind === 'suppression') {
    await tx
      .update(transactions)
      .set({ isSuppressed: (d.payload as SuppressionPayload).suppressed })
      .where(and(eq(transactions.id, d.transactionId), eq(transactions.workspaceId, d.workspaceId)));
  }
  return inserted!;
}

/** Records decisions, then re-runs automatic matching and rebuilds the projection, atomically. */
export async function recordDecisions(tx: Executor, workspaceId: string, decisions: NewDecision[]) {
  await lockWorkspace(tx, workspaceId);
  const results = [];
  for (const d of decisions) results.push(await appendDecision(tx, d));
  await refreshProjection(tx, workspaceId);
  return results;
}
