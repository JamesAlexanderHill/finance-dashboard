import { add, eq, type DecimalString } from '@finance/shared';

export type DecisionKind = 'category' | 'tags' | 'suppression' | 'itemisation' | 'link';

export interface DecisionRecord {
  id: string;
  seq: number;
  transactionId: string;
  kind: DecisionKind;
  legKey: string;
  payload: unknown;
}

export interface CategoryPayload {
  categoryId: string | null;
}
export interface TagsPayload {
  tagIds: string[];
}
export interface SuppressionPayload {
  suppressed: boolean;
}
export interface ItemisationLine {
  amount: DecimalString;
  description: string;
}
/** `lines: null` undoes an itemisation. */
export interface ItemisationPayload {
  lines: ItemisationLine[] | null;
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

export class ItemisationError extends Error {}

/** Line items must sum exactly to the transaction amount and share its sign. */
export function validateItemisation(transactionAmount: DecimalString, lines: readonly ItemisationLine[]): void {
  if (lines.length < 2) throw new ItemisationError('An itemisation needs at least two line items');
  const total = add(...lines.map((l) => l.amount));
  if (!eq(total, transactionAmount)) {
    throw new ItemisationError(`Line items sum to ${total}, but the transaction amount is ${transactionAmount}`);
  }
  const negative = transactionAmount.startsWith('-');
  for (const line of lines) {
    if (eq(line.amount, '0') || line.amount.startsWith('-') !== negative) {
      throw new ItemisationError('Every line item must be non-zero and have the same sign as the transaction');
    }
  }
}
