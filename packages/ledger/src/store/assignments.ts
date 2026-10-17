import { and, desc, eq } from 'drizzle-orm';
import { legAssignments, type Executor } from '@finance/db';
import type { AssignmentKind } from '../assignments';
import { lockWorkspace } from './lock';
import { refreshProjection } from './refresh';

export interface NewAssignment {
  workspaceId: string;
  transactionId: string;
  legKey: string;
  kind: AssignmentKind;
  payload: unknown;
  userId: string | null;
}

/** Appends an assignment that supersedes the current one for the same (leg, kind). */
export async function appendAssignment(tx: Executor, a: NewAssignment) {
  const [previous] = await tx
    .select({ id: legAssignments.id })
    .from(legAssignments)
    .where(
      and(
        eq(legAssignments.workspaceId, a.workspaceId),
        eq(legAssignments.transactionId, a.transactionId),
        eq(legAssignments.legKey, a.legKey),
        eq(legAssignments.kind, a.kind),
      ),
    )
    .orderBy(desc(legAssignments.seq))
    .limit(1);

  const [inserted] = await tx
    .insert(legAssignments)
    .values({
      workspaceId: a.workspaceId,
      transactionId: a.transactionId,
      legKey: a.legKey,
      kind: a.kind,
      payload: a.payload,
      supersedesId: previous?.id ?? null,
      actor: a.userId ? 'user' : 'system',
      createdBy: a.userId,
    })
    .returning();
  return inserted!;
}

/** Records leg assignments, then rebuilds the projection, atomically. */
export async function recordAssignments(tx: Executor, workspaceId: string, assignments: NewAssignment[]) {
  await lockWorkspace(tx, workspaceId);
  const results = [];
  for (const a of assignments) results.push(await appendAssignment(tx, a));
  await refreshProjection(tx, workspaceId);
  return results;
}
