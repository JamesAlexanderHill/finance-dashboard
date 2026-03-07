import { eq, and, inArray } from 'drizzle-orm'
import { db } from '~/db'
import { files, events, legs } from '~/db/schema'
import type { RequestContext } from '../utils/context'
import { buildPaginatedResult, type PaginationOptions } from '../utils/pagination'
import {
  queryFilesByUser,
  queryFilesByAccount,
  queryFileById,
  queryFileCountsByAccount,
} from '../query/file'

async function getById(ctx: RequestContext, fileId: string) {
  return queryFileById(ctx.userId, fileId)
}

async function listByUser(ctx: RequestContext, opts: PaginationOptions = {}) {
  const { limit = 20, offset = 0 } = opts
  const { data, total } = await queryFilesByUser(ctx.userId, opts)
  return buildPaginatedResult(data, total, limit, offset)
}

async function listByAccount(ctx: RequestContext, accountId: string, opts: PaginationOptions = {}) {
  const { limit = 20, offset = 0 } = opts
  const { data, total } = await queryFilesByAccount(ctx.userId, accountId, opts)
  return buildPaginatedResult(data, total, limit, offset)
}

async function countsByAccount(
  ctx: RequestContext,
  accountIds: string[],
): Promise<{ accountId: string; count: number }[]> {
  return queryFileCountsByAccount(ctx.userId, accountIds)
}

async function remove(ctx: RequestContext, fileId: string) {
  const file = await queryFileById(ctx.userId, fileId)
  if (!file) throw new Error(`File not found: ${fileId}`)

  await db.transaction(async (tx) => {
    const fileEvents = await tx
      .select({ id: events.id })
      .from(events)
      .where(and(eq(events.fileId, fileId), eq(events.userId, ctx.userId)))

    if (fileEvents.length > 0) {
      await tx.delete(legs).where(inArray(legs.eventId, fileEvents.map((e) => e.id)))
    }

    await tx.delete(events).where(eq(events.fileId, fileId))
    await tx.delete(files).where(eq(files.id, fileId))
  })
}

export const fileService = { getById, listByUser, listByAccount, countsByAccount, delete: remove }
