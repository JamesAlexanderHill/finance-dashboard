import { createServerFn } from '@tanstack/react-start';
import { and, asc, desc, eq, gte, ilike, inArray, lte, sql, type SQL } from 'drizzle-orm';
import {
  idInput,
  itemiseInput,
  setCategoryInput,
  setSuppressionInput,
  setTagsInput,
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
import { validateItemisation } from '@finance/ledger';
import { recordDecisions } from '@finance/ledger/store';
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
  amount: string;
  description: string;
  categoryId: string | null;
  tagIds: string[];
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
        ? sql`exists (select 1 from event_legs l where l.transaction_id = ${transactions.id} and l.category_id is null)`
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
        legs: sql<LegView[]>`coalesce((select json_agg(json_build_object(
            'id', l.id, 'legKey', l.leg_key, 'amount', l.amount::text, 'description', l.description,
            'categoryId', l.category_id, 'tagIds', l.tag_ids) order by l.leg_key)
          from event_legs l where l.transaction_id = ${transactions.id}), '[]'::json)`,
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
    const [sources, history] = await Promise.all([
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
    ]);
    return {
      sources: sources.map((s) => ({ ...s, fileDeletedAt: s.fileDeletedAt?.toISOString() ?? null, linkedAt: s.linkedAt.toISOString() })),
      history: history.map(({ payload, ...h }) => ({ ...h, payload: JSON.stringify(payload), createdAt: h.createdAt.toISOString() })),
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
        { workspaceId, transactionId: data.transactionId, kind: 'category', legKey: data.legKey, payload: { categoryId: data.categoryId }, userId },
      ]),
    );
  });

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
        { workspaceId, transactionId: data.transactionId, kind: 'tags', legKey: data.legKey, payload: { tagIds: rows.map((r) => r.id) }, userId },
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
