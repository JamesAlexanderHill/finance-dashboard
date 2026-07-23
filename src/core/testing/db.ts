import { like } from 'drizzle-orm'
import { db } from '~/core/database'
import { users } from '~/core/database/schema'

/**
 * Finds user ids whose email ends with `domain` (e.g. `@authtest.example`).
 * Integration tests use a dedicated domain per suite so their cleanup helpers
 * can scope deletes to only the data that suite created.
 */
export async function queryTestUserIdsByEmailDomain(domain: string): Promise<string[]> {
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(like(users.email, `%${domain}`))
  return rows.map((r) => r.id)
}
