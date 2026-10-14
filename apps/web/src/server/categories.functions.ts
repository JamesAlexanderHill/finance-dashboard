import { createServerFn } from '@tanstack/react-start';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { createCategoryInput, deleteCategoryInput, renameCategoryInput } from '@finance/contracts';
import { categories, getDb, tags } from '@finance/db';
import { lockWorkspace, recordDecisions } from '@finance/ledger/store';
import { workspaceMiddleware } from './session';

export class CategoryError extends Error {}

export const listCategories = createServerFn({ method: 'GET' })
  .middleware([workspaceMiddleware])
  .handler(async ({ context }) => {
    const db = getDb();
    const [cats, tagRows] = await Promise.all([
      db
        .select({
          id: categories.id,
          parentId: categories.parentId,
          name: categories.name,
          kind: categories.kind,
          isFixed: categories.isFixed,
          legCount: sql<number>`(select count(*)::int from event_legs l where l.category_id = "categories"."id")`,
        })
        .from(categories)
        .where(and(eq(categories.workspaceId, context.workspaceId), isNull(categories.archivedAt)))
        .orderBy(asc(categories.sortOrder), asc(categories.name)),
      db.select({ id: tags.id, name: tags.name }).from(tags).where(eq(tags.workspaceId, context.workspaceId)).orderBy(asc(tags.name)),
    ]);
    return { categories: cats, tags: tagRows };
  });

async function getCategory(workspaceId: string, id: string) {
  const [c] = await getDb()
    .select()
    .from(categories)
    .where(and(eq(categories.id, id), eq(categories.workspaceId, workspaceId), isNull(categories.archivedAt)));
  if (!c) throw new CategoryError('Category not found');
  return c;
}

export const createCategory = createServerFn({ method: 'POST' })
  .middleware([workspaceMiddleware])
  .validator(createCategoryInput)
  .handler(async ({ context, data }) => {
    const parent = await getCategory(context.workspaceId, data.parentId);
    const [created] = await getDb()
      .insert(categories)
      .values({ workspaceId: context.workspaceId, parentId: parent.id, name: data.name, kind: parent.kind })
      .returning({ id: categories.id });
    return created!;
  });

export const renameCategory = createServerFn({ method: 'POST' })
  .middleware([workspaceMiddleware])
  .validator(renameCategoryInput)
  .handler(async ({ context, data }) => {
    const c = await getCategory(context.workspaceId, data.id);
    if (c.isFixed) throw new CategoryError('Top-level categories cannot be renamed');
    await getDb().update(categories).set({ name: data.name }).where(eq(categories.id, c.id));
  });

/**
 * Deletes (archives) a child category. Its legs are reassigned by appending new category decisions,
 * so history is kept and the projection never points at an archived category.
 */
export const deleteCategory = createServerFn({ method: 'POST' })
  .middleware([workspaceMiddleware])
  .validator(deleteCategoryInput)
  .handler(async ({ context, data }) => {
    const { workspaceId, userId } = context;
    const c = await getCategory(workspaceId, data.id);
    if (c.isFixed) throw new CategoryError('Top-level categories cannot be deleted');
    if (data.reassignTo === c.id) throw new CategoryError('Choose a different category to move its legs to');
    const target = await getCategory(workspaceId, data.reassignTo);
    if (target.kind !== c.kind) throw new CategoryError('Legs can only move to a category of the same kind');

    await getDb().transaction(async (tx) => {
      await lockWorkspace(tx, workspaceId);
      const [child] = await tx
        .select({ id: categories.id })
        .from(categories)
        .where(and(eq(categories.parentId, c.id), isNull(categories.archivedAt)))
        .limit(1);
      if (child) throw new CategoryError('Delete or move its subcategories first');

      const current = await tx.execute<{ transaction_id: string; leg_key: string }>(sql`
        select transaction_id, leg_key from (
          select distinct on (transaction_id, leg_key) transaction_id, leg_key, payload
          from reconciliation_decisions
          where workspace_id = ${workspaceId} and kind = 'category'
          order by transaction_id, leg_key, seq desc
        ) latest where latest.payload->>'categoryId' = ${c.id}
      `);
      await tx
        .update(categories)
        .set({ archivedAt: sql`now()` })
        .where(eq(categories.id, c.id));
      await recordDecisions(
        tx,
        workspaceId,
        [...current].map((d) => ({
          workspaceId,
          transactionId: d.transaction_id,
          kind: 'category' as const,
          legKey: d.leg_key,
          payload: { categoryId: target.id },
          userId,
        })),
      );
    });
  });
