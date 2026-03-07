import { eq, and, desc, count, inArray, sql } from 'drizzle-orm'
import { db } from '~/db'
import { events, legs } from '~/db/schema'
import type { PaginationOptions } from '../utils/pagination'

const eventWith = {
  account: true as const,
  legs: { with: { instrument: true as const } },
}

export async function queryEventsByAccount(userId: string, accountId: string, opts: PaginationOptions = {}) {
  const { limit = 20, offset = 0 } = opts
  const where = and(eq(events.userId, userId), eq(events.accountId, accountId))

  const [data, [{ total }]] = await Promise.all([
    db.query.events.findMany({ where, orderBy: [desc(events.effectiveAt)], limit, offset, with: eventWith }),
    db.select({ total: count() }).from(events).where(where),
  ])

  return { data, total }
}

export async function queryEventsByFile(userId: string, fileId: string, opts: PaginationOptions = {}) {
  const { limit = 20, offset = 0 } = opts
  const where = and(eq(events.userId, userId), eq(events.fileId, fileId))

  const [data, [{ total }]] = await Promise.all([
    db.query.events.findMany({ where, orderBy: [desc(events.effectiveAt)], limit, offset, with: eventWith }),
    db.select({ total: count() }).from(events).where(where),
  ])

  return { data, total }
}

export async function queryAllEvents(
  userId: string,
  opts: PaginationOptions & { accountId?: string } = {},
) {
  const { limit = 20, offset = 0, accountId } = opts
  const where = and(
    eq(events.userId, userId),
    accountId ? eq(events.accountId, accountId) : undefined,
  )

  const [data, [{ total }]] = await Promise.all([
    db.query.events.findMany({ where, orderBy: [desc(events.effectiveAt)], limit, offset, with: eventWith }),
    db.select({ total: count() }).from(events).where(where),
  ])

  return { data, total }
}

/**
 * Events that have at least one leg for the given instrument.
 * Uses a two-step approach: paginate event IDs via join, then fetch with relations.
 * Only legs for the specified instrument are included on each event.
 */
export async function queryEventsByInstrument(
  userId: string,
  instrumentId: string,
  opts: PaginationOptions = {},
) {
  const { limit = 20, offset = 0 } = opts

  const [countResult, idRows] = await Promise.all([
    db
      .select({ total: sql<number>`count(distinct ${events.id})` })
      .from(events)
      .innerJoin(legs, and(eq(legs.eventId, events.id), eq(legs.instrumentId, instrumentId)))
      .where(eq(events.userId, userId)),
    db
      .selectDistinct({ id: events.id, effectiveAt: events.effectiveAt })
      .from(events)
      .innerJoin(legs, and(eq(legs.eventId, events.id), eq(legs.instrumentId, instrumentId)))
      .where(eq(events.userId, userId))
      .orderBy(desc(events.effectiveAt))
      .limit(limit)
      .offset(offset),
  ])

  const total = Number(countResult[0]?.total ?? 0)
  if (idRows.length === 0) return { data: [], total }

  const data = await db.query.events.findMany({
    where: inArray(events.id, idRows.map((r) => r.id)),
    orderBy: [desc(events.effectiveAt)],
    with: {
      account: true,
      legs: {
        where: eq(legs.instrumentId, instrumentId),
        with: { instrument: true },
      },
    },
  })

  return { data, total }
}

export async function queryEventByDedupeKey(dedupeKey: string) {
  const [event] = await db
    .select({ id: events.id, deletedAt: events.deletedAt })
    .from(events)
    .where(eq(events.dedupeKey, dedupeKey))

  return event ?? null
}
