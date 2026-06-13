import { eq } from 'drizzle-orm'
import { db } from '~/db'
import { categories } from '~/db/schema'

export async function queryCategoriesByWorkspace(workspaceId: string) {
  return db.select().from(categories).where(eq(categories.workspaceId, workspaceId))
}
