import { eq, and } from 'drizzle-orm'
import { db } from '~/db'
import { categories, legs, lineItems } from '~/db/schema'
import { uuidv7 } from 'uuidv7'
import type { RequestContext } from '../utils/context'
import { queryCategoriesByWorkspace } from '../query/category'

async function list(ctx: RequestContext) {
  return queryCategoriesByWorkspace(ctx.workspaceId)
}

async function create(ctx: RequestContext, name: string, parentId: string | null) {
  const [cat] = await db
    .insert(categories)
    .values({ id: uuidv7(), workspaceId: ctx.workspaceId, parentId, name })
    .returning()
  return cat
}

async function rename(ctx: RequestContext, id: string, name: string) {
  await db
    .update(categories)
    .set({ name })
    .where(and(eq(categories.id, id), eq(categories.workspaceId, ctx.workspaceId)))
}

async function remove(ctx: RequestContext, id: string) {
  const children = await db
    .select({ id: categories.id })
    .from(categories)
    .where(and(eq(categories.workspaceId, ctx.workspaceId), eq(categories.parentId, id)))

  if (children.length > 0) {
    throw new Error('Delete sub-categories first before deleting this category.')
  }

  await db
    .update(legs)
    .set({ categoryId: null })
    .where(and(eq(legs.workspaceId, ctx.workspaceId), eq(legs.categoryId, id)))

  await db
    .update(lineItems)
    .set({ categoryId: null })
    .where(and(eq(lineItems.workspaceId, ctx.workspaceId), eq(lineItems.categoryId, id)))

  await db
    .delete(categories)
    .where(and(eq(categories.id, id), eq(categories.workspaceId, ctx.workspaceId)))
}

export const categoryService = { list, create, rename, remove }
