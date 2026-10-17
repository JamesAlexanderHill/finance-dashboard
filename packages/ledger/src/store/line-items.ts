import { and, eq, inArray } from 'drizzle-orm';
import { transactionLineItems, transactions, type Executor } from '@finance/db';
import { ItemisationError, validateItemisation, type LineItemInput } from '../line-items';
import { lockWorkspace } from './lock';
import { refreshProjection } from './refresh';

/** A line item to save; one with an `id` keeps its identity, so its leg keeps its category. */
export interface LineItemChange extends LineItemInput {
  id?: string;
}

/**
 * Replaces a transaction's line items (feature 05), or removes them all with `lines: null`. Lines must
 * sum exactly to the transaction amount. Lines sent back with their `id` are updated in place; others
 * are added; missing ones are deleted (assignments on their legs are kept but no longer projected).
 */
export async function setLineItems(
  tx: Executor,
  workspaceId: string,
  transactionId: string,
  lines: LineItemChange[] | null,
  userId: string | null,
) {
  await lockWorkspace(tx, workspaceId);
  const [owner] = await tx
    .select({ amount: transactions.amount, role: transactions.role })
    .from(transactions)
    .where(and(eq(transactions.id, transactionId), eq(transactions.workspaceId, workspaceId)));
  if (!owner) throw new ItemisationError('Transaction not found');
  if (lines && owner.role !== 'principal') throw new ItemisationError('Only a principal transaction can be itemised');
  if (lines) validateItemisation(owner.amount, lines);

  const existing = await tx
    .select({ id: transactionLineItems.id })
    .from(transactionLineItems)
    .where(and(eq(transactionLineItems.transactionId, transactionId), eq(transactionLineItems.workspaceId, workspaceId)));
  const existingIds = new Set(existing.map((l) => l.id));
  const keep = new Set((lines ?? []).flatMap((l) => (l.id ? [l.id] : [])));
  for (const id of keep) if (!existingIds.has(id)) throw new ItemisationError('Line item not found');
  if (keep.size !== (lines ?? []).filter((l) => l.id).length) throw new ItemisationError('A line item appears twice');

  const removed = [...existingIds].filter((id) => !keep.has(id));
  if (removed.length) await tx.delete(transactionLineItems).where(inArray(transactionLineItems.id, removed));
  for (const [position, line] of (lines ?? []).entries()) {
    if (line.id) {
      await tx
        .update(transactionLineItems)
        .set({ position, amount: line.amount, description: line.description })
        .where(eq(transactionLineItems.id, line.id));
    } else {
      await tx
        .insert(transactionLineItems)
        .values({ workspaceId, transactionId, position, amount: line.amount, description: line.description, createdBy: userId });
    }
  }
  await refreshProjection(tx, workspaceId);
}
