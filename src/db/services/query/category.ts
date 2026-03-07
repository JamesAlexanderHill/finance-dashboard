import { eq } from 'drizzle-orm'
import { db } from '~/db'
import { categories } from '~/db/schema'

export async function queryCategoriesByUser(userId: string) {
  return db.select().from(categories).where(eq(categories.userId, userId))
}
