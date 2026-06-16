import { eq, and, inArray, desc, count, sql } from 'drizzle-orm'
import { db } from '~/db'
import { files } from '~/db/schema'
import type { PaginationOptions } from '../utils/pagination'

export async function queryFilesByWorkspace(workspaceId: string, opts: PaginationOptions = {}) {
  const { limit = 20, offset = 0 } = opts
  const where = eq(files.workspaceId, workspaceId)

  const [data, [{ total }]] = await Promise.all([
    db.query.files.findMany({ where, orderBy: [desc(files.createdAt)], limit, offset }),
    db.select({ total: count() }).from(files).where(where),
  ])

  return { data, total }
}

export async function queryFilesByAccount(workspaceId: string, accountId: string, opts: PaginationOptions = {}) {
  const { limit = 20, offset = 0 } = opts
  const where = and(eq(files.workspaceId, workspaceId), eq(files.accountId, accountId))

  const [data, [{ total }]] = await Promise.all([
    db.query.files.findMany({ where, orderBy: [desc(files.createdAt)], limit, offset }),
    db.select({ total: count() }).from(files).where(where),
  ])

  return { data, total }
}

export async function queryFileById(workspaceId: string, fileId: string) {
  const [file] = await db
    .select()
    .from(files)
    .where(and(eq(files.id, fileId), eq(files.workspaceId, workspaceId)))

  return file ?? null
}

export async function queryFileCountsByAccount(
  workspaceId: string,
  accountIds: string[],
): Promise<{ accountId: string; count: number }[]> {
  if (!accountIds.length) return []

  const rows = await db
    .select({
      accountId: files.accountId,
      count: sql<number>`count(*)`,
    })
    .from(files)
    .where(and(eq(files.workspaceId, workspaceId), inArray(files.accountId, accountIds)))
    .groupBy(files.accountId)

  return rows.map((r) => ({ accountId: r.accountId, count: Number(r.count) }))
}
