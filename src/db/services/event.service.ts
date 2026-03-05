import { eq, and, desc, count } from 'drizzle-orm'
import { db } from '~/db'
import { events } from '~/db/schema'
import type { RequestContext } from './context'
import { buildPaginatedResult, type PaginationOptions } from './pagination'

type ListEventsOptions = PaginationOptions & {
  accountId?: string
}

async function list(ctx: RequestContext, opts: ListEventsOptions = {}) {
  const { limit = 20, offset = 0, accountId } = opts

  const where = and(
    eq(events.userId, ctx.userId),
    accountId ? eq(events.accountId, accountId) : undefined,
  )

  const [data, [{ total }]] = await Promise.all([
    db.query.events.findMany({
      where,
      orderBy: [desc(events.effectiveAt)],
      limit,
      offset,
      with: {
        account: true,
        legs: { with: { instrument: true } },
      },
    }),
    db.select({ total: count() }).from(events).where(where),
  ])

  return buildPaginatedResult(data, total, limit, offset)
}

export const eventService = { list }
