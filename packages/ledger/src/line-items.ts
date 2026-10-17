import { add, eq, type DecimalString } from '@finance/shared';

/** One part of a transaction the user added (feature 05); it becomes its own leg. */
export interface LineItem {
  id: string;
  transactionId: string;
  position: number;
  amount: DecimalString;
  description: string;
}

export interface LineItemInput {
  amount: DecimalString;
  description: string;
}

export class ItemisationError extends Error {}

/** Line items must sum exactly to the transaction amount and share its sign. */
export function validateItemisation(transactionAmount: DecimalString, lines: readonly LineItemInput[]): void {
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

/** Whether stored line items can stand in for their transaction: the same rules as when they were saved. */
export function lineItemsValid(transactionAmount: DecimalString, lines: readonly LineItemInput[]): boolean {
  try {
    validateItemisation(transactionAmount, lines);
    return true;
  } catch {
    return false;
  }
}

export const lineLegKey = (lineItemId: string) => `line:${lineItemId}`;
