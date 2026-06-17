import { eq, and, inArray, count } from 'drizzle-orm'
import { db } from '~/db'
import { timelineAnnotations } from '~/db/schema'
import type { PaginationOptions } from '../utils/pagination'

export async function queryAnnotationsByAccount(
  workspaceId: string,
  accountId: string,
  opts: PaginationOptions = {},
) {
  const { limit = 200, offset = 0 } = opts
  const where = and(
    eq(timelineAnnotations.workspaceId, workspaceId),
    eq(timelineAnnotations.accountId, accountId),
  )
  const [data, [{ total }]] = await Promise.all([
    db.query.timelineAnnotations.findMany({
      where,
      limit,
      offset,
      orderBy: timelineAnnotations.date,
    }),
    db.select({ total: count() }).from(timelineAnnotations).where(where),
  ])
  return { data, total }
}

export async function queryAnnotationsByWorkspace(
  workspaceId: string,
  accountIds?: string[],
) {
  const where = and(
    eq(timelineAnnotations.workspaceId, workspaceId),
    accountIds?.length ? inArray(timelineAnnotations.accountId, accountIds) : undefined,
  )
  return db.query.timelineAnnotations.findMany({
    where,
    orderBy: timelineAnnotations.date,
  })
}

export async function queryAnnotationById(workspaceId: string, id: string) {
  const [row] = await db
    .select()
    .from(timelineAnnotations)
    .where(and(eq(timelineAnnotations.id, id), eq(timelineAnnotations.workspaceId, workspaceId)))
  return row ?? null
}
