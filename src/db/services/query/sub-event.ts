import { and, desc, eq, gte, inArray, isNull, lte, notInArray, or, sql } from 'drizzle-orm'
import { db } from '~/db'
import { eventRelations, events, legs, subEventLinks } from '~/db/schema'

// Decoration shared by parent/child lookups and the picker, mirroring
// `relatedEventWith` in query/relation.ts — enough to render account, amounts,
// and per-leg/line-item categories for display and rollup.
const relatedEventWith = {
  account: true as const,
  legs: {
    with: {
      instrument: true as const,
      category: true as const,
      lineItems: { with: { category: true as const } },
    },
  },
}

/**
 * An event that already has a parent — used to exclude it from candidate
 * sets, and (via `excludeSubEventChildren`, reused by `query/event.ts`) from
 * top-level event listings, since a linked sub-event is only ever browsed
 * nested under its parent. A plain `notInArray` subquery rather than a raw
 * `NOT EXISTS` `sql` fragment: interpolating a bare column reference via the
 * `sql` tag renders with whatever table alias drizzle's relational query
 * builder has in scope at that point (observed rendering
 * `events.child_event_id` instead of `sub_event_links.child_event_id` when
 * nested inside `db.query.events.findMany`), so it silently breaks depending
 * on the surrounding query shape.
 */
export function excludeSubEventChildren() {
  return notInArray(
    events.id,
    db.select({ id: subEventLinks.childEventId }).from(subEventLinks),
  )
}

/** All sub-events linked under `parentEventId`, decorated for display, oldest first. */
export async function queryChildrenForParent(workspaceId: string, parentEventId: string) {
  return db.query.events.findMany({
    where: and(
      eq(events.workspaceId, workspaceId),
      inArray(
        events.id,
        db
          .select({ id: subEventLinks.childEventId })
          .from(subEventLinks)
          .where(eq(subEventLinks.parentEventId, parentEventId)),
      ),
    ),
    orderBy: [events.effectiveAt],
    with: relatedEventWith,
  })
}

/** The single parent link + decorated parent event for `childEventId`, or null. */
export async function queryParentForChild(workspaceId: string, childEventId: string) {
  const link = await db.query.subEventLinks.findFirst({
    where: eq(subEventLinks.childEventId, childEventId),
  })
  if (!link) return null

  const parentEvent = await db.query.events.findFirst({
    where: and(eq(events.id, link.parentEventId), eq(events.workspaceId, workspaceId)),
    with: relatedEventWith,
  })
  if (!parentEvent) return null

  return { parentEventId: link.parentEventId, parentEvent }
}

/** Batched sub-event child counts for a set of (candidate parent) events, scoped to the workspace. */
export async function querySubEventCountsForEvents(workspaceId: string, eventIds: string[]) {
  if (eventIds.length === 0) return new Map<string, number>()

  const rows = await db
    .select({ parentEventId: subEventLinks.parentEventId, total: sql<number>`count(*)` })
    .from(subEventLinks)
    .innerJoin(events, eq(events.id, subEventLinks.parentEventId))
    .where(and(eq(events.workspaceId, workspaceId), inArray(subEventLinks.parentEventId, eventIds)))
    .groupBy(subEventLinks.parentEventId)

  return new Map(rows.map((r) => [r.parentEventId, Number(r.total)]))
}

/**
 * Candidate events for the "link sub-events" picker's free-text search.
 * Mirrors `queryEventsForLinking` (query/relation.ts) but always excludes
 * events that already have a parent (a sub-event belongs to exactly one
 * parent) and optionally restricts to one account.
 */
export async function queryEventsForSubEventPicker(
  workspaceId: string,
  params: { query?: string; accountId?: string; excludeEventIds?: string[]; limit?: number } = {},
) {
  const { query = '', accountId, excludeEventIds = [], limit = 25 } = params
  const q = query.trim()

  const base = [
    eq(events.workspaceId, workspaceId),
    isNull(events.deletedAt),
    accountId ? eq(events.accountId, accountId) : undefined,
    excludeEventIds.length ? notInArray(events.id, excludeEventIds) : undefined,
    excludeSubEventChildren(),
  ]

  let idRows: { id: string }[]
  if (q.length === 0) {
    idRows = await db
      .select({ id: events.id })
      .from(events)
      .where(and(...base))
      .orderBy(desc(events.effectiveAt))
      .limit(limit)
  } else {
    const numeric = /^\d+$/.test(q) ? BigInt(q) : null
    idRows = await db
      .selectDistinct({ id: events.id, effectiveAt: events.effectiveAt })
      .from(events)
      .innerJoin(legs, eq(legs.eventId, events.id))
      .where(
        and(
          ...base,
          or(
            sql`${events.description} ILIKE ${'%' + q + '%'}`,
            numeric !== null ? sql`abs(${legs.unitCount}) = ${numeric}` : sql`false`,
          ),
        ),
      )
      .orderBy(desc(events.effectiveAt))
      .limit(limit)
  }

  if (idRows.length === 0) return []

  return db.query.events.findMany({
    where: inArray(
      events.id,
      idRows.map((r) => r.id),
    ),
    orderBy: [desc(events.effectiveAt)],
    with: relatedEventWith,
  })
}

/**
 * Non-deleted, decorated events on `accountId` within `[start, end]`,
 * excluding the given ids and any event that already has a parent. The
 * caller (`subEventService.suggestGroupings`) computes the statement window
 * and the pure `suggestSubEventGroup` applies the outflow/ordering rules.
 */
export async function querySubEventCandidates(
  workspaceId: string,
  params: { accountId: string; start: Date; end: Date; excludeEventIds?: string[] },
) {
  const { accountId, start, end, excludeEventIds = [] } = params
  return db.query.events.findMany({
    where: and(
      eq(events.workspaceId, workspaceId),
      eq(events.accountId, accountId),
      isNull(events.deletedAt),
      gte(events.effectiveAt, start),
      lte(events.effectiveAt, end),
      excludeEventIds.length ? notInArray(events.id, excludeEventIds) : undefined,
      excludeSubEventChildren(),
    ),
    orderBy: [desc(events.effectiveAt)],
    with: relatedEventWith,
  })
}

/**
 * Resolves the "paired account" for a prospective sub-event parent: the
 * counterpart account of an existing `transfer` relation on this event if one
 * exists (a certain signal — the checking-side outflow is normally already
 * transfer-linked to the card account's payment-received credit), otherwise
 * the most frequent historical transfer counterpart for this event's own
 * account. Returns null if neither yields a signal.
 */
export async function queryPairedAccountForEvent(workspaceId: string, eventId: string) {
  const event = await db.query.events.findFirst({ where: eq(events.id, eventId) })
  if (!event) return null

  const direct = await db.query.eventRelations.findFirst({
    where: and(
      eq(eventRelations.relationType, 'transfer'),
      or(eq(eventRelations.parentEventId, eventId), eq(eventRelations.childEventId, eventId)),
    ),
    with: { parentEvent: true, childEvent: true },
  })
  if (direct) {
    return direct.parentEventId === eventId ? direct.childEvent.accountId : direct.parentEvent.accountId
  }

  // Fallback: most frequent counterpart account among past `transfer`
  // relations touching this event's own account (either side).
  const asParent = await db
    .select({ otherAccountId: events.accountId })
    .from(eventRelations)
    .innerJoin(events, eq(events.id, eventRelations.childEventId))
    .where(
      and(
        eq(eventRelations.relationType, 'transfer'),
        eq(events.workspaceId, workspaceId),
        inArray(
          eventRelations.parentEventId,
          db.select({ id: events.id }).from(events).where(eq(events.accountId, event.accountId)),
        ),
      ),
    )
  const asChild = await db
    .select({ otherAccountId: events.accountId })
    .from(eventRelations)
    .innerJoin(events, eq(events.id, eventRelations.parentEventId))
    .where(
      and(
        eq(eventRelations.relationType, 'transfer'),
        eq(events.workspaceId, workspaceId),
        inArray(
          eventRelations.childEventId,
          db.select({ id: events.id }).from(events).where(eq(events.accountId, event.accountId)),
        ),
      ),
    )

  const freq = new Map<string, number>()
  for (const { otherAccountId } of [...asParent, ...asChild]) {
    freq.set(otherAccountId, (freq.get(otherAccountId) ?? 0) + 1)
  }
  let best: string | null = null
  let bestCount = 0
  for (const [accountId, n] of freq) {
    if (n > bestCount) {
      best = accountId
      bestCount = n
    }
  }
  return best
}
