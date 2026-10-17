import { createServerFn } from '@tanstack/react-start';
import { and, asc, desc, eq, gte, ilike, inArray, lte, sql, type SQL } from 'drizzle-orm';
import {
  acceptSuggestionsInput,
  idInput,
  itemiseInput,
  setCategoryForLegsInput,
  setCategoryInput,
  setReceiptRemovedInput,
  setSuppressionInput,
  setTagsInput,
  similarLegsInput,
  transactionFilter,
} from '@finance/contracts';
import {
  categories,
  financialAccounts,
  getDb,
  reconciliationDecisions,
  sourceFiles,
  sourceRecords,
  tags,
  transactions,
  transactionSources,
} from '@finance/db';
import { listReceipts, setReceiptRemoved } from '@finance/imports';
import { validateItemisation } from '@finance/ledger';
import { acceptSuggestions, categoriseLegs, findSimilarLegs, recordDecisions, suggestCategories } from '@finance/ledger/store';
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

export interface LegView {
  id: string;
  legKey: string;
  role: 'principal' | 'fee' | 'line_item';
  amount: string;
  description: string;
  categoryId: string | null;
  /** The category suggested for an uncategorised leg (feature 14); it counts only once accepted. */
  suggestedCategoryId: string | null;
  tagIds: string[];
}

export interface EventView {
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
      data.uncategorisedOnly
        ? // Only legs that count as cash flow need a category (not internal principal legs).
          sql`exists (select 1 from event_legs l join events e on e.id = l.event_id
            where l.transaction_id = ${transactions.id} and l.category_id is null and (not e.is_internal or l.role = 'fee'))`
        : undefined,
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
            'categoryId', l.category_id, 'tagIds', l.tag_ids) order by l.leg_key)
          from event_legs l where l.transaction_id = ${transactions.id}), '[]'::json)`,
        event: sql<EventView | null>`(select json_build_object('type', e.type, 'status', e.status, 'isInternal', e.is_internal,
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
    const page = rows.slice(0, data.limit);
    const suggestions = new Map(
      (
        await suggestCategories(
          getDb(),
          context.workspaceId,
          page.map((r) => r.id),
        )
      ).map((s) => [`${s.transactionId}:${s.legKey}`, s.categoryId]),
    );
    return {
      rows: page.map((r) => ({
        ...r,
        legs: r.legs.map((l) => ({ ...l, suggestedCategoryId: suggestions.get(`${r.id}:${l.legKey}`) ?? null })),
      })),
      hasMore: rows.length > data.limit,
    };
  });

export const getTransactionDetail = createServerFn({ method: 'GET' })
  .middleware([workspaceMiddleware])
  .validator(idInput)
  .handler(async ({ context, data }) => {
    await ownedTransaction(context.workspaceId, data.id);
    const db = getDb();
    const [sources, history, receipts] = await Promise.all([
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
      listReceipts(db, context.workspaceId, data.id),
    ]);
    return {
      sources: sources.map((s) => ({ ...s, fileDeletedAt: s.fileDeletedAt?.toISOString() ?? null, linkedAt: s.linkedAt.toISOString() })),
      history: history.map(({ payload, ...h }) => ({ ...h, payload: JSON.stringify(payload), createdAt: h.createdAt.toISOString() })),
      receipts,
    };
  });

export const setLegCategory = createServerFn({ method: 'POST' })
  .middleware([workspaceMiddleware])
  .validator(setCategoryInput)
  .handler(async ({ context, data }) => {
    const { workspaceId, userId } = context;
    await ownedTransaction(workspaceId, data.transactionId);
    if (data.categoryId) {
      const [c] = await getDb()
        .select({ id: categories.id })
        .from(categories)
        .where(and(eq(categories.id, data.categoryId), eq(categories.workspaceId, workspaceId)));
      if (!c) throw new TransactionError('Category not found');
    }
    await getDb().transaction((tx) =>
      recordDecisions(tx, workspaceId, [
        {
          workspaceId,
          transactionId: data.transactionId,
          kind: 'category',
          legKey: data.legKey,
          payload: { categoryId: data.categoryId },
          userId,
        },
      ]),
    );
  });

/** Gives every selected leg one category; each leg still gets its own decision. */
export const setCategoryForLegs = createServerFn({ method: 'POST' })
  .middleware([workspaceMiddleware])
  .validator(setCategoryForLegsInput)
  .handler(({ context, data }) =>
    getDb().transaction((tx) => categoriseLegs(tx, context.workspaceId, data.legs, data.categoryId, context.userId)),
  );

/**
 * Transactions like the one being categorised, in three sections (identical, similar, already in another
 * category), so the user can tick which also get the category. Applying goes through `setCategoryForLegs`.
 */
export const findSimilarTransactions = createServerFn({ method: 'GET' })
  .middleware([workspaceMiddleware])
  .validator(similarLegsInput)
  .handler(async ({ context, data }) => {
    await ownedTransaction(context.workspaceId, data.transactionId);
    return findSimilarLegs(getDb(), context.workspaceId, data);
  });

/** Accepts the suggested category of each given leg; each gets an ordinary category decision. */
export const acceptCategorySuggestions = createServerFn({ method: 'POST' })
  .middleware([workspaceMiddleware])
  .validator(acceptSuggestionsInput)
  .handler(({ context, data }) => getDb().transaction((tx) => acceptSuggestions(tx, context.workspaceId, data.legs, context.userId)));

export const setLegTags = createServerFn({ method: 'POST' })
  .middleware([workspaceMiddleware])
  .validator(setTagsInput)
  .handler(async ({ context, data }) => {
    const { workspaceId, userId } = context;
    await ownedTransaction(workspaceId, data.transactionId);
    const names = [...new Set(data.tagNames)];
    await getDb().transaction(async (tx) => {
      if (names.length) {
        await tx
          .insert(tags)
          .values(names.map((name) => ({ workspaceId, name })))
          .onConflictDoNothing();
      }
      const rows = names.length
        ? await tx
            .select({ id: tags.id })
            .from(tags)
            .where(and(eq(tags.workspaceId, workspaceId), inArray(tags.name, names)))
        : [];
      await recordDecisions(tx, workspaceId, [
        {
          workspaceId,
          transactionId: data.transactionId,
          kind: 'tags',
          legKey: data.legKey,
          payload: { tagIds: rows.map((r) => r.id) },
          userId,
        },
      ]);
    });
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

/** Itemises a transaction into line items (or undoes it with `lines: null`). Lines must sum exactly. */
export const itemiseTransaction = createServerFn({ method: 'POST' })
  .middleware([workspaceMiddleware])
  .validator(itemiseInput)
  .handler(async ({ context, data }) => {
    const { workspaceId, userId } = context;
    const tx = await ownedTransaction(workspaceId, data.transactionId);
    if (data.lines) validateItemisation(tx.amount, data.lines);
    await getDb().transaction((db) =>
      recordDecisions(db, workspaceId, [
        { workspaceId, transactionId: tx.id, kind: 'itemisation', payload: { lines: data.lines }, userId },
      ]),
    );
  });

/** Removes a receipt (its file is retained) or restores it. Uploading goes through `/api/receipts`. */
export const setReceiptRemoval = createServerFn({ method: 'POST' })
  .middleware([workspaceMiddleware])
  .validator(setReceiptRemovedInput)
  .handler(({ context, data }) => setReceiptRemoved(getDb(), context.workspaceId, data.sourceFileId, data.removed, context.userId));
