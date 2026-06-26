import { eq, and, inArray } from 'drizzle-orm'
import { db } from '~/db'
import { files, events, legs } from '~/db/schema'
import { deleteObject, getSignedDownloadUrl } from '~/lib/storage'
import type { RequestContext } from '../utils/context'
import { buildPaginatedResult, type PaginationOptions } from '../utils/pagination'
import {
  queryFilesByWorkspace,
  queryFilesByAccount,
  queryFileById,
  queryFileCountsByAccount,
} from '../query/file'
import { checkpointService } from './checkpoint'
import { rateService } from './rate'

async function getById(ctx: RequestContext, fileId: string) {
  return queryFileById(ctx.workspaceId, fileId)
}

/** Returns a short-lived download URL for a file's stored original, or null if none. */
async function getDownloadUrl(ctx: RequestContext, fileId: string): Promise<string | null> {
  const file = await queryFileById(ctx.workspaceId, fileId)
  if (!file || !file.storageKey) return null
  return getSignedDownloadUrl(file.storageKey, file.filename)
}

async function listByUser(ctx: RequestContext, opts: PaginationOptions = {}) {
  const { limit = 20, offset = 0 } = opts
  const { data, total } = await queryFilesByWorkspace(ctx.workspaceId, opts)
  return buildPaginatedResult(data, total, limit, offset)
}

async function listByAccount(ctx: RequestContext, accountId: string, opts: PaginationOptions = {}) {
  const { limit = 20, offset = 0 } = opts
  const { data, total } = await queryFilesByAccount(ctx.workspaceId, accountId, opts)
  return buildPaginatedResult(data, total, limit, offset)
}

async function countsByAccount(
  ctx: RequestContext,
  accountIds: string[],
): Promise<{ accountId: string; count: number }[]> {
  return queryFileCountsByAccount(ctx.workspaceId, accountIds)
}

async function remove(ctx: RequestContext, fileId: string) {
  const file = await queryFileById(ctx.workspaceId, fileId)
  if (!file) throw new Error(`File not found: ${fileId}`)

  const affectedInstrumentIds = await db.transaction(async (tx) => {
    const fileEvents = await tx
      .select({ id: events.id })
      .from(events)
      .where(and(eq(events.fileId, fileId), eq(events.workspaceId, ctx.workspaceId)))

    let instrumentIds: string[] = []
    if (fileEvents.length > 0) {
      const eventIds = fileEvents.map((e) => e.id)
      const affectedLegs = await tx
        .selectDistinct({ instrumentId: legs.instrumentId })
        .from(legs)
        .where(inArray(legs.eventId, eventIds))
      instrumentIds = affectedLegs.map((l) => l.instrumentId)

      await tx.delete(legs).where(inArray(legs.eventId, eventIds))
    }

    await tx.delete(events).where(eq(events.fileId, fileId))
    await tx.delete(files).where(eq(files.id, fileId))

    return instrumentIds
  })

  // Remove the stored original (best-effort — the import is already deleted).
  if (file.storageKey) {
    try {
      await deleteObject(file.storageKey)
    } catch (err) {
      console.error(`Failed to delete stored file ${file.storageKey}: ${String(err)}`)
    }
  }

  for (const instrumentId of affectedInstrumentIds) {
    await checkpointService.refresh(ctx, instrumentId)
    await rateService.refresh(ctx, instrumentId)
  }
}

export const fileService = { getById, getDownloadUrl, listByUser, listByAccount, countsByAccount, delete: remove }
