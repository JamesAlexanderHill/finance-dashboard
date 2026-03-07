import { eq, and, desc, count } from 'drizzle-orm'
import { db } from '~/db'
import { files } from '~/db/schema'
import type { RequestContext } from '../utils/context'
import { buildPaginatedResult, type PaginationOptions } from '../utils/pagination'

type ListFilesOptions = PaginationOptions & {
  accountId?: string
}

async function list(ctx: RequestContext, opts: ListFilesOptions = {}) {
  const { limit = 20, offset = 0, accountId } = opts

  const where = and(
    eq(files.userId, ctx.userId),
    accountId ? eq(files.accountId, accountId) : undefined,
  )

  const [data, [{ total }]] = await Promise.all([
    db.query.files.findMany({ where, orderBy: [desc(files.createdAt)], limit, offset }),
    db.select({ total: count() }).from(files).where(where),
  ])

  return buildPaginatedResult(data, total, limit, offset)
}

export const fileService = { list }
