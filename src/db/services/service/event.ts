import type { RequestContext } from '../utils/context'
import { buildPaginatedResult, type PaginationOptions } from '../utils/pagination'
import {
  queryEventsByAccount,
  queryEventsByFile,
  queryEventsByInstrument,
  queryAllEvents,
} from '../query/event'

async function listByAccount(ctx: RequestContext, accountId: string, opts: PaginationOptions = {}) {
  const { limit = 20, offset = 0 } = opts
  const { data, total } = await queryEventsByAccount(ctx.userId, accountId, opts)
  return buildPaginatedResult(data, total, limit, offset)
}

async function listByFile(ctx: RequestContext, fileId: string, opts: PaginationOptions = {}) {
  const { limit = 20, offset = 0 } = opts
  const { data, total } = await queryEventsByFile(ctx.userId, fileId, opts)
  return buildPaginatedResult(data, total, limit, offset)
}

async function listByInstrument(ctx: RequestContext, instrumentId: string, opts: PaginationOptions = {}) {
  const { limit = 20, offset = 0 } = opts
  const { data, total } = await queryEventsByInstrument(ctx.userId, instrumentId, opts)
  return buildPaginatedResult(data, total, limit, offset)
}

async function listAll(
  ctx: RequestContext,
  opts: PaginationOptions & { accountId?: string } = {},
) {
  const { limit = 20, offset = 0 } = opts
  const { data, total } = await queryAllEvents(ctx.userId, opts)
  return buildPaginatedResult(data, total, limit, offset)
}

export const eventService = { listByAccount, listByFile, listByInstrument, listAll }
