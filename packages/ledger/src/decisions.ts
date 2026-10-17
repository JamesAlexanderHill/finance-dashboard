/**
 * Reconciliation decisions on transactions. Categories and tags are leg assignments and itemisation is
 * line items (ADR 0014); older `category`, `tags` and `itemisation` rows are kept in the table but ignored.
 */
export type DecisionKind = 'suppression' | 'link' | 'transfer';

export interface DecisionRecord {
  id: string;
  seq: number;
  transactionId: string;
  kind: DecisionKind;
  legKey: string;
  payload: unknown;
}

export interface SuppressionPayload {
  suppressed: boolean;
}
/**
 * Links transactions into one event (e.g. both halves of a transfer). Every member gets a decision
 * with the same `groupId`; `groupId: null` unlinks that transaction.
 */
export interface LinkPayload {
  groupId: string | null;
}
/** Marks a transaction as a transfer between own accounts (or not), overriding the source's hint. */
export interface TransferPayload {
  isTransfer: boolean;
}
export const decisionKey = (transactionId: string, kind: DecisionKind, legKey = '') => `${transactionId}|${kind}|${legKey}`;

/** Latest decision per (transaction, kind, leg key); later decisions supersede earlier ones. */
export function currentDecisions(decisions: readonly DecisionRecord[]): Map<string, DecisionRecord> {
  const current = new Map<string, DecisionRecord>();
  for (const d of [...decisions].sort((a, b) => a.seq - b.seq)) {
    current.set(decisionKey(d.transactionId, d.kind, d.legKey), d);
  }
  return current;
}
