import { sql } from 'drizzle-orm'
import { db } from '~/core/database'
import { getEnv } from '~/core/config'
import type { HealthCheck } from '~/core/features'

/** Core health check: is the environment configuration valid (see `~/core/config`). */
export const environmentHealthCheck: HealthCheck = {
  name: 'environment',
  async check() {
    try {
      getEnv()
      return { ok: true }
    } catch (err) {
      return { ok: false, detail: err instanceof Error ? err.message : String(err) }
    }
  },
}

/** Core health check: can we round-trip a trivial query against Postgres. */
export const databaseHealthCheck: HealthCheck = {
  name: 'database',
  async check() {
    try {
      await db.execute(sql`select 1`)
      return { ok: true }
    } catch (err) {
      return { ok: false, detail: String(err) }
    }
  },
}

export type HealthReport = {
  ok: boolean
  checks: { name: string; ok: boolean; detail?: string }[]
}

/**
 * Runs the core checks plus any feature-registered checks and aggregates the
 * result. Intended to back a `/api/health` route.
 */
export async function runHealthChecks(featureChecks: readonly HealthCheck[] = []): Promise<HealthReport> {
  const all = [environmentHealthCheck, databaseHealthCheck, ...featureChecks]
  const results = await Promise.all(
    all.map(async (c) => {
      const result = await c.check()
      return { name: c.name, ...result }
    }),
  )
  return { ok: results.every((r) => r.ok), checks: results }
}
