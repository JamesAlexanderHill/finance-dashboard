import type { RequestContext } from '../utils/context'
import { buildPaginatedResult, type PaginationOptions } from '../utils/pagination'
import {
  queryEventsByAccount,
  queryEventsByFile,
  queryEventsByInstrument,
  queryAllEvents,
  queryUncategorizedEvents,
  querySimilarUncategorizedEvents,
} from '../query/event'

async function listByAccount(ctx: RequestContext, accountId: string, opts: PaginationOptions = {}) {
  const { limit = 20, offset = 0 } = opts
  const { data, total } = await queryEventsByAccount(ctx.workspaceId, accountId, opts)
  return buildPaginatedResult(data, total, limit, offset)
}

async function listByFile(ctx: RequestContext, fileId: string, opts: PaginationOptions = {}) {
  const { limit = 20, offset = 0 } = opts
  const { data, total } = await queryEventsByFile(ctx.workspaceId, fileId, opts)
  return buildPaginatedResult(data, total, limit, offset)
}

async function listByInstrument(ctx: RequestContext, instrumentId: string, opts: PaginationOptions = {}) {
  const { limit = 20, offset = 0 } = opts
  const { data, total } = await queryEventsByInstrument(ctx.workspaceId, instrumentId, opts)
  return buildPaginatedResult(data, total, limit, offset)
}

async function listAll(
  ctx: RequestContext,
  opts: PaginationOptions & { accountId?: string } = {},
) {
  const { limit = 20, offset = 0 } = opts
  const { data, total } = await queryAllEvents(ctx.workspaceId, opts)
  return buildPaginatedResult(data, total, limit, offset)
}

async function listUncategorized(ctx: RequestContext, opts: PaginationOptions = {}) {
  const { limit = 10, offset = 0 } = opts
  const { data, total } = await queryUncategorizedEvents(ctx.workspaceId, opts)
  return buildPaginatedResult(data, total, limit, offset)
}

async function listSimilarUncategorized(
  ctx: RequestContext,
  excludeEventId: string,
  description: string,
  firstLegUnitCount: bigint,
) {
  return querySimilarUncategorizedEvents(ctx.workspaceId, excludeEventId, description, firstLegUnitCount)
}

export const eventService = { listByAccount, listByFile, listByInstrument, listAll, listUncategorized, listSimilarUncategorized }
