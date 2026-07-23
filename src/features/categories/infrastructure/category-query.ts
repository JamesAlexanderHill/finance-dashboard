import { eq } from 'drizzle-orm'
import { db } from '~/core/database'
import { categories } from '~/core/database/schema'

export async function queryCategoriesByWorkspace(workspaceId: string) {
  return db.select().from(categories).where(eq(categories.workspaceId, workspaceId))
}
