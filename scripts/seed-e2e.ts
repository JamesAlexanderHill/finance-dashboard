/**
 * Seeds the database the e2e suite runs against. Run as its own process so the
 * `db` singleton picks up the test DATABASE_URL, e.g.
 *
 *   DATABASE_URL=postgresql://dev:development@localhost:5332/db_test \
 *     bun run scripts/seed-e2e.ts
 *
 * Prints the shared workspace id (which holds the sample accounts/events) as
 * JSON on the last line so callers can select it.
 */
import { clearAllData, seedBase, seedSampleEvents } from '~/lib/seed'

await clearAllData()
const { workspaceId } = await seedBase()
await seedSampleEvents(workspaceId)

console.log(JSON.stringify({ workspaceId }))
process.exit(0)
