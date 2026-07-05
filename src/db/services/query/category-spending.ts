import { and, eq, isNull, gte, lte } from 'drizzle-orm'
import { db } from '~/db'
import { categories, legs, events, lineItems } from '~/db/schema'
import { queryAnalyticsRelations } from './relation'

/**
 * Legs (with any line items grouped on) for the given date range, decorated
 * with each leg's `eventId`/`effectiveAt` for bucketing, plus relation
 * context for netting. Shared by the category-spending and Sankey services.
 *
 * A leg with `categoryId: null` but categorized line items IS included here —
 * the line items are its effective category breakdown (see
 * `resolveLegCategoryShares`), so filtering on `isNotNull(legs.categoryId)`
 * would incorrectly hide it from analytics.
 */
export async function queryLegsWithLineItemsByDate(
  workspaceId: string,
  dateRange?: { start: string | null; end: string },
) {
  const cats = await db
    .select()
    .from(categories)
    .where(eq(categories.workspaceId, workspaceId))

  const dateFilters = [
    dateRange?.start ? gte(events.effectiveAt, new Date(dateRange.start)) : undefined,
    dateRange?.end ? lte(events.effectiveAt, new Date(dateRange.end + 'T23:59:59.999Z')) : undefined,
  ]

  const [legRows, lineItemRows, relationData] = await Promise.all([
    db
      .select({
        legId: legs.id,
        eventId: legs.eventId,
        categoryId: legs.categoryId,
        unitCount: legs.unitCount,
        effectiveAt: events.effectiveAt,
      })
      .from(legs)
      .innerJoin(events, eq(legs.eventId, events.id))
      .where(and(eq(legs.workspaceId, workspaceId), isNull(events.deletedAt), ...dateFilters)),
    db
      .select({
        legId: lineItems.legId,
        categoryId: lineItems.categoryId,
        unitCount: lineItems.unitCount,
      })
      .from(lineItems)
      .innerJoin(legs, eq(lineItems.legId, legs.id))
      .innerJoin(events, eq(legs.eventId, events.id))
      .where(and(eq(legs.workspaceId, workspaceId), isNull(events.deletedAt), ...dateFilters)),
    queryAnalyticsRelations(workspaceId, dateRange),
  ])

  const lineItemsByLeg = new Map<string, { categoryId: string | null; unitCount: bigint }[]>()
  for (const item of lineItemRows) {
    if (!lineItemsByLeg.has(item.legId)) lineItemsByLeg.set(item.legId, [])
    lineItemsByLeg.get(item.legId)!.push({ categoryId: item.categoryId, unitCount: item.unitCount })
  }

  const legsWithItems = legRows.map((leg) => ({
    eventId: leg.eventId,
    categoryId: leg.categoryId,
    unitCount: leg.unitCount,
    effectiveAt: leg.effectiveAt,
    lineItems: lineItemsByLeg.get(leg.legId) ?? [],
  }))

  return { categories: cats, legs: legsWithItems, ...relationData }
}
