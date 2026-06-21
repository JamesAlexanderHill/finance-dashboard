import { and, eq, isNull, isNotNull, gte, lte } from 'drizzle-orm'
import { db } from '~/db'
import { categories, legs, events } from '~/db/schema'

export async function queryCategoryLegsByDate(
  workspaceId: string,
  dateRange?: { start: string | null; end: string },
) {
  const cats = await db
    .select()
    .from(categories)
    .where(eq(categories.workspaceId, workspaceId))

  const rows = await db
    .select({
      categoryId: legs.categoryId,
      unitCount: legs.unitCount,
      effectiveAt: events.effectiveAt,
    })
    .from(legs)
    .innerJoin(events, eq(legs.eventId, events.id))
    .where(
      and(
        eq(legs.workspaceId, workspaceId),
        isNull(events.deletedAt),
        isNotNull(legs.categoryId),
        dateRange?.start ? gte(events.effectiveAt, new Date(dateRange.start)) : undefined,
        dateRange?.end
          ? lte(events.effectiveAt, new Date(dateRange.end + 'T23:59:59.999Z'))
          : undefined,
      ),
    )

  return { categories: cats, legs: rows }
}
