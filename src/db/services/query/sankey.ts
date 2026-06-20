import { and, eq, isNull, isNotNull } from 'drizzle-orm'
import { db } from '~/db'
import { categories, legs, events } from '~/db/schema'

export async function querySankeyLegs(workspaceId: string) {
  const cats = await db
    .select()
    .from(categories)
    .where(eq(categories.workspaceId, workspaceId))

  const categorizedLegs = await db
    .select({
      categoryId: legs.categoryId,
      unitCount: legs.unitCount,
    })
    .from(legs)
    .innerJoin(events, eq(legs.eventId, events.id))
    .where(
      and(
        eq(legs.workspaceId, workspaceId),
        isNull(events.deletedAt),
        isNotNull(legs.categoryId),
      ),
    )

  return { categories: cats, legs: categorizedLegs }
}
