import { eq, and, inArray, count } from 'drizzle-orm'
import { db } from '~/db'
import { accounts } from '~/db/schema'
import type { RequestContext } from '../utils/context'
import { buildPaginatedResult, type PaginationOptions } from '../utils/pagination'

type ListAccountsOptions = PaginationOptions & {
  accountIds?: string[]
}

async function list(ctx: RequestContext, opts: ListAccountsOptions = {}) {
  const { limit = 1000, offset = 0, accountIds } = opts

  const where = and(
    eq(accounts.userId, ctx.userId),
    accountIds?.length ? inArray(accounts.id, accountIds) : undefined,
  )

  const [data, [{ total }]] = await Promise.all([
    db.query.accounts.findMany({ where, limit, offset, with: { instruments: true } }),
    db.select({ total: count() }).from(accounts).where(where),
  ])

  return buildPaginatedResult(data, total, limit, offset)
}

export const accountService = { list }
