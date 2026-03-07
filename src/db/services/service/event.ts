import { eq, and, desc, count } from 'drizzle-orm'
import { db } from '~/db'
import { events, legs } from '~/db/schema'
import type { RequestContext } from '../utils/context'
import { buildPaginatedResult, type PaginationOptions } from '../utils/pagination'

type ListEventsOptions = PaginationOptions & {
  accountId?: string,
  instrumentId?: string,
  fileId?: string,  
}

async function list(ctx: RequestContext, opts: ListEventsOptions = {}) {
  const { limit = 20, offset = 0, accountId, instrumentId, fileId } = opts

  const where = and(
    eq(events.userId, ctx.userId),
    accountId ? eq(events.accountId, accountId) : undefined,
    fileId ? eq(events.fileId, fileId) : undefined,
  )

  const [data, [{ total }]] = await Promise.all([
    db.query.events.findMany({
      where,
      orderBy: [desc(events.effectiveAt)],
      limit,
      offset,
      with: {
        account: true,
        legs: {
          where: instrumentId ? eq(legs.instrumentId, instrumentId) : undefined,
          with: {
            instrument: true
          }
        },
      },
    }),
    db.select({ total: count() }).from(events).where(where),
  ])

  return buildPaginatedResult(data, total, limit, offset)
}

export const eventService = { list }
