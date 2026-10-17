/** What a leg assignment sets on a leg (ADR 0014). */
export type AssignmentKind = 'category' | 'tags';

/** A category or tag assignment on a leg, named by its stable identity (transaction + leg key). */
export interface AssignmentRecord {
  id: string;
  seq: number;
  transactionId: string;
  legKey: string;
  kind: AssignmentKind;
  payload: unknown;
}

export interface CategoryPayload {
  categoryId: string | null;
}
export interface TagsPayload {
  tagIds: string[];
}

export const assignmentKey = (transactionId: string, legKey: string, kind: AssignmentKind) => `${transactionId}|${legKey}|${kind}`;

/** Latest assignment per (transaction, leg key, kind); later assignments supersede earlier ones. */
export function currentAssignments(assignments: readonly AssignmentRecord[]): Map<string, AssignmentRecord> {
  const current = new Map<string, AssignmentRecord>();
  for (const a of [...assignments].sort((x, y) => x.seq - y.seq)) current.set(assignmentKey(a.transactionId, a.legKey, a.kind), a);
  return current;
}
