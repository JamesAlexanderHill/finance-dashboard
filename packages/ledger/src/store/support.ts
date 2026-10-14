import { and, eq, inArray, sql } from 'drizzle-orm';
import { transactions, type Executor } from '@finance/db';

/**
 * Recomputes `is_source_supported`: a transaction is supported while any of its source rows
 * belongs to a source file that is not soft-deleted.
 */
export async function refreshTransactionSupport(tx: Executor, workspaceId: string, transactionIds?: string[]) {
  if (transactionIds && transactionIds.length === 0) return;
  await tx
    .update(transactions)
    .set({
      isSourceSupported: sql`exists (
        select 1 from transaction_sources ts
        join source_records sr on sr.id = ts.source_record_id
        join source_files sf on sf.id = sr.source_file_id
        where ts.transaction_id = ${transactions.id} and sf.deleted_at is null
      )`,
      updatedAt: sql`now()`,
    })
    .where(and(eq(transactions.workspaceId, workspaceId), transactionIds ? inArray(transactions.id, transactionIds) : undefined));
}
