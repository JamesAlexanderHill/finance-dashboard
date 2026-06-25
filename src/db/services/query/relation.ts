import { and, desc, eq, gte, inArray, isNull, lte, notInArray, or, sql } from 'drizzle-orm'
import { db } from '~/db'
import { eventRelations, events, legs, type EventRelationType } from '~/db/schema'

// Decoration shared by both directions of a relation and by the link picker, so
// the drawer can render the related event's account, amounts, and categories.
const relatedEventWith = {
  account: true as const,
  legs: { with: { instrument: true as const, category: true as const } },
}

/**
 * All relations touching `eventId`, in both directions, with the *other* event
 * decorated for display. `parentRelations` are relations where this event is the
 * parent (the anchor/outflow); `childRelations` are where it is the child.
 *
 * Scoping note: `event_relations` has no workspace column — it is scoped through
 * its events. The caller passes a workspace-validated `eventId`, and relations are
 * only ever created within a single workspace, so the related events are
 * guaranteed to belong to the same workspace.
 */
export async function queryRelationsForEvent(workspaceId: string, eventId: string) {
  const [parentRelations, childRelations] = await Promise.all([
    db.query.eventRelations.findMany({
      where: eq(eventRelations.parentEventId, eventId),
      with: { childEvent: { with: relatedEventWith } },
    }),
    db.query.eventRelations.findMany({
      where: eq(eventRelations.childEventId, eventId),
      with: { parentEvent: { with: relatedEventWith } },
    }),
  ])

  return { parentRelations, childRelations }
}

/**
 * Candidate events for the "link transaction" picker. Matches on a description
 * substring and, when the query is a plain integer, on the absolute minor-unit
 * amount of any leg (useful for finding the matching side of a transfer). Always
 * excludes soft-deleted events and the provided ids (the anchor + already-linked
 * events). Modelled on `querySimilarUncategorizedEvents` in query/event.ts.
 */
export async function queryEventsForLinking(
  workspaceId: string,
  params: { query?: string; excludeEventIds?: string[]; limit?: number } = {},
) {
  const { query = '', excludeEventIds = [], limit = 25 } = params
  const q = query.trim()

  const base = [
    eq(events.workspaceId, workspaceId),
    isNull(events.deletedAt),
    excludeEventIds.length ? notInArray(events.id, excludeEventIds) : undefined,
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

export type AnalyticsRelation = {
  parentEventId: string
  childEventId: string
  relationType: EventRelationType
}

export type AnalyticsChildLeg = {
  eventId: string
  categoryId: string | null
  unitCount: bigint
  effectiveAt: Date
}

/**
 * Relation context for the spend/income analytics: every relation in the
 * workspace, plus the legs of reimbursement/refund *child* events (categorised or
 * not, date-scoped) so they can be netted against their parent's category. Shared
 * by the category-spending and Sankey queries. See `applyRelationsToLegs`.
 */
export async function queryAnalyticsRelations(
  workspaceId: string,
  dateRange?: { start: string | null; end: string },
): Promise<{ relations: AnalyticsRelation[]; childLegs: AnalyticsChildLeg[] }> {
  // event_relations has no workspace column — scope through the parent event
  // (both sides of a relation always share a workspace).
  const relations = await db
    .select({
      parentEventId: eventRelations.parentEventId,
      childEventId: eventRelations.childEventId,
      relationType: eventRelations.relationType,
    })
    .from(eventRelations)
    .innerJoin(events, eq(events.id, eventRelations.parentEventId))
    .where(eq(events.workspaceId, workspaceId))

  const childLegRows = await db
    .select({
      id: legs.id,
      eventId: legs.eventId,
      categoryId: legs.categoryId,
      unitCount: legs.unitCount,
      effectiveAt: events.effectiveAt,
    })
    .from(legs)
    .innerJoin(events, eq(legs.eventId, events.id))
    .innerJoin(
      eventRelations,
      and(
        eq(eventRelations.childEventId, events.id),
        inArray(eventRelations.relationType, ['reimbursement', 'refund']),
      ),
    )
    .where(
      and(
        eq(legs.workspaceId, workspaceId),
        isNull(events.deletedAt),
        dateRange?.start ? gte(events.effectiveAt, new Date(dateRange.start)) : undefined,
        dateRange?.end
          ? lte(events.effectiveAt, new Date(dateRange.end + 'T23:59:59.999Z'))
          : undefined,
      ),
    )

  // A child event reimbursed against more than one parent would join twice;
  // dedupe by leg id so each child leg is netted exactly once.
  const seen = new Set<string>()
  const childLegs: AnalyticsChildLeg[] = []
  for (const row of childLegRows) {
    if (seen.has(row.id)) continue
    seen.add(row.id)
    childLegs.push({
      eventId: row.eventId,
      categoryId: row.categoryId,
      unitCount: row.unitCount,
      effectiveAt: row.effectiveAt,
    })
  }

  return { relations, childLegs }
}
