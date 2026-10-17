import { createServerFn } from '@tanstack/react-start';
import { and, asc, desc, eq, gte, ilike, lte, sql, type SQL } from 'drizzle-orm';
import { idInput, setLineItemsInput, setReceiptRemovedInput, setSuppressionInput, transactionFilter } from '@finance/contracts';
import {
  financialAccounts,
  getDb,
  legAssignments,
  reconciliationDecisions,
  sourceFiles,
  sourceRecords,
  transactions,
  transactionSources,
} from '@finance/db';
import { listReceipts, setReceiptRemoved } from '@finance/imports';
import { recordDecisions, setLineItems } from '@finance/ledger/store';
import { workspaceMiddleware } from './session';

export class TransactionError extends Error {}

async function ownedTransaction(workspaceId: string, id: string) {
  const [tx] = await getDb()
    .select()
    .from(transactions)
    .where(and(eq(transactions.id, id), eq(transactions.workspaceId, workspaceId)));
  if (!tx) throw new TransactionError('Transaction not found');
  return tx;
}

/** A leg this transaction contributes to its event. Read-only here: legs are categorised on the Events page. */
export interface LegView {
  id: string;
  legKey: string;
  role: 'principal' | 'fee' | 'line_item';
  amount: string;
  description: string;
  categoryName: string | null;
}

/** A part of the transaction the user added; together they sum exactly to its amount. */
export interface LineItemView {
  id: string;
  amount: string;
  description: string;
}

export interface EventView {
  id: string;
  type: string;
  status: 'ok' | 'unmatched_transfer';
  isInternal: boolean;
  members: number;
}

export const listTransactions = createServerFn({ method: 'GET' })
  .middleware([workspaceMiddleware])
  .validator(transactionFilter)
  .handler(async ({ context, data }) => {
    const active = and(eq(transactions.isSourceSupported, true), eq(transactions.isSuppressed, false));
    const where: Array<SQL | undefined> = [
      eq(transactions.workspaceId, context.workspaceId),
      data.id ? eq(transactions.id, data.id) : undefined,
      data.accountId ? eq(transactions.accountId, data.accountId) : undefined,
      data.from ? gte(transactions.postedOn, data.from) : undefined,
      data.to ? lte(transactions.postedOn, data.to) : undefined,
      data.search ? ilike(transactions.description, `%${data.search}%`) : undefined,
      data.status === 'active' ? active : data.status === 'inactive' ? sql`not (${active})` : undefined,
    ];
    const rows = await getDb()
      .select({
        id: transactions.id,
        postedOn: transactions.postedOn,
        description: transactions.description,
        amount: transactions.amount,
        commodity: transactions.commodity,
        accountId: transactions.accountId,
        accountName: financialAccounts.name,
        isSourceSupported: transactions.isSourceSupported,
        isSuppressed: transactions.isSuppressed,
        sourceCount: sql<number>`(select count(*)::int from transaction_sources ts where ts.transaction_id = ${transactions.id})`,
        receiptCount: sql<number>`(select count(*)::int from transaction_receipts r join source_files f on f.id = r.source_file_id
          where r.transaction_id = ${transactions.id} and f.deleted_at is null)`,
        legs: sql<LegView[]>`coalesce((select json_agg(json_build_object(
            'id', l.id, 'legKey', l.leg_key, 'role', l.role, 'amount', l.amount::text, 'description', l.description,
            'categoryName', c.name) order by l.leg_key)
          from event_legs l left join categories c on c.id = l.category_id where l.transaction_id = ${transactions.id}), '[]'::json)`,
        lineItems: sql<LineItemView[]>`coalesce((select json_agg(json_build_object(
            'id', li.id, 'amount', li.amount::text, 'description', li.description) order by li.position)
          from transaction_line_items li where li.transaction_id = ${transactions.id}), '[]'::json)`,
        event: sql<EventView | null>`(select json_build_object('id', e.id, 'type', e.type, 'status', e.status, 'isInternal', e.is_internal,
            'members', (select count(*) from event_transaction_links x where x.event_id = e.id))
          from event_transaction_links etl join events e on e.id = etl.event_id where etl.transaction_id = ${transactions.id} limit 1)`,
        isLinked: sql<boolean>`coalesce((select d.payload->>'groupId' is not null from reconciliation_decisions d
          where d.transaction_id = ${transactions.id} and d.kind = 'link' order by d.seq desc limit 1), false)`,
        isTransferHint: transactions.isTransferHint,
      })
      .from(transactions)
      .innerJoin(financialAccounts, eq(financialAccounts.id, transactions.accountId))
      .where(and(...where))
      .orderBy(desc(transactions.postedOn), desc(transactions.createdAt))
      .limit(data.limit + 1)
      .offset(data.offset);
    return { rows: rows.slice(0, data.limit), hasMore: rows.length > data.limit };
  });

export const getTransactionDetail = createServerFn({ method: 'GET' })
  .middleware([workspaceMiddleware])
  .validator(idInput)
  .handler(async ({ context, data }) => {
    await ownedTransaction(context.workspaceId, data.id);
    const db = getDb();
    const [sources, decisions, assignments, receipts] = await Promise.all([
      db
        .select({
          sourceFileId: sourceFiles.id,
          fileName: sourceFiles.originalName,
          fileDeletedAt: sourceFiles.deletedAt,
          rowIndex: sourceRecords.rowIndex,
          description: sourceRecords.description,
          runningBalance: sourceRecords.runningBalance,
          linkedAt: transactionSources.createdAt,
        })
        .from(transactionSources)
        .innerJoin(sourceRecords, eq(sourceRecords.id, transactionSources.sourceRecordId))
        .innerJoin(sourceFiles, eq(sourceFiles.id, sourceRecords.sourceFileId))
        .where(eq(transactionSources.transactionId, data.id))
        .orderBy(asc(transactionSources.createdAt)),
      db
        .select({
          id: reconciliationDecisions.id,
          kind: reconciliationDecisions.kind,
          legKey: reconciliationDecisions.legKey,
          payload: reconciliationDecisions.payload,
          actor: reconciliationDecisions.actor,
          createdAt: reconciliationDecisions.createdAt,
        })
        .from(reconciliationDecisions)
        .where(and(eq(reconciliationDecisions.transactionId, data.id), eq(reconciliationDecisions.workspaceId, context.workspaceId)))
        .orderBy(desc(reconciliationDecisions.seq)),
      db
        .select({
          id: legAssignments.id,
          kind: legAssignments.kind,
          legKey: legAssignments.legKey,
          payload: legAssignments.payload,
          actor: legAssignments.actor,
          createdAt: legAssignments.createdAt,
        })
        .from(legAssignments)
        .where(and(eq(legAssignments.transactionId, data.id), eq(legAssignments.workspaceId, context.workspaceId))),
      listReceipts(db, context.workspaceId, data.id),
    ]);
    return {
      sources: sources.map((s) => ({ ...s, fileDeletedAt: s.fileDeletedAt?.toISOString() ?? null, linkedAt: s.linkedAt.toISOString() })),
      // Reconciliation decisions on the transaction and category/tag assignments on its legs, newest first.
      history: [...decisions, ...assignments]
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .map(({ payload, ...h }) => ({ ...h, payload: JSON.stringify(payload), createdAt: h.createdAt.toISOString() })),
      receipts,
    };
  });

export const setSuppression = createServerFn({ method: 'POST' })
  .middleware([workspaceMiddleware])
  .validator(setSuppressionInput)
  .handler(async ({ context, data }) => {
    const { workspaceId, userId } = context;
    await ownedTransaction(workspaceId, data.transactionId);
    await getDb().transaction((tx) =>
      recordDecisions(tx, workspaceId, [
        { workspaceId, transactionId: data.transactionId, kind: 'suppression', payload: { suppressed: data.suppressed }, userId },
      ]),
    );
  });

/** Sets a transaction's line items (or removes them with `lines: null`). Lines must sum exactly to its amount. */
export const saveLineItems = createServerFn({ method: 'POST' })
  .middleware([workspaceMiddleware])
  .validator(setLineItemsInput)
  .handler(async ({ context, data }) => {
    const { workspaceId, userId } = context;
    await ownedTransaction(workspaceId, data.transactionId);
    await getDb().transaction((tx) => setLineItems(tx, workspaceId, data.transactionId, data.lines, userId));
  });

/** Removes a receipt (its file is retained) or restores it. Uploading goes through `/api/receipts`. */
export const setReceiptRemoval = createServerFn({ method: 'POST' })
  .middleware([workspaceMiddleware])
  .validator(setReceiptRemovedInput)
  .handler(({ context, data }) => setReceiptRemoved(getDb(), context.workspaceId, data.sourceFileId, data.removed, context.userId));
