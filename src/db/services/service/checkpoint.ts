import { eq, and, isNull, lt, sql } from 'drizzle-orm'
import { db } from '~/db'
import { instrumentCheckpoints, instruments, legs, events } from '~/db/schema'
import type { RequestContext } from '../utils/context'

/**
 * Recompute and replace all monthly checkpoints for an instrument.
 * Checkpoints only cover fully-completed calendar months — the current
 * month is never checkpointed.
 */
async function refresh(ctx: RequestContext, instrumentId: string): Promise<void> {
  const now = new Date()
  const currentMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))

  const monthlySums = await db
    .select({
      month: sql<string>`date_trunc('month', ${events.effectiveAt})`,
      total: sql<string>`SUM(${legs.unitCount})`,
    })
    .from(legs)
    .innerJoin(events, eq(legs.eventId, events.id))
    .where(and(
      eq(legs.instrumentId, instrumentId),
      eq(legs.workspaceId, ctx.workspaceId),
      isNull(events.deletedAt),
      lt(events.effectiveAt, currentMonthStart),
    ))
    .groupBy(sql`date_trunc('month', ${events.effectiveAt})`)
    .orderBy(sql`date_trunc('month', ${events.effectiveAt})`)

  let running = BigInt(0)
  const rows = monthlySums.map((row) => {
    running += BigInt(row.total)
    const monthStart = new Date(row.month)
    const periodEnd = new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + 1, 1))
    return { workspaceId: ctx.workspaceId, instrumentId, periodEnd, balance: running }
  })

  await db.transaction(async (tx) => {
    await tx.delete(instrumentCheckpoints).where(and(
      eq(instrumentCheckpoints.workspaceId, ctx.workspaceId),
      eq(instrumentCheckpoints.instrumentId, instrumentId),
    ))
    if (rows.length > 0) await tx.insert(instrumentCheckpoints).values(rows)
  })
}

/** Refresh checkpoints for every instrument in the workspace. */
async function refreshAll(ctx: RequestContext): Promise<number> {
  const workspaceInstruments = await db
    .select({ id: instruments.id })
    .from(instruments)
    .where(eq(instruments.workspaceId, ctx.workspaceId))

  for (const { id } of workspaceInstruments) await refresh(ctx, id)

  return workspaceInstruments.length
}

export const checkpointService = { refresh, refreshAll }
