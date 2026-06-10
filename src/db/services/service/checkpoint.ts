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
      eq(legs.userId, ctx.userId),
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
    return { userId: ctx.userId, instrumentId, periodEnd, balance: running }
  })

  await db.transaction(async (tx) => {
    await tx.delete(instrumentCheckpoints).where(and(
      eq(instrumentCheckpoints.userId, ctx.userId),
      eq(instrumentCheckpoints.instrumentId, instrumentId),
    ))
    if (rows.length > 0) await tx.insert(instrumentCheckpoints).values(rows)
  })
}

/** Refresh checkpoints for every instrument owned by the user. */
async function refreshAll(ctx: RequestContext): Promise<number> {
  const userInstruments = await db
    .select({ id: instruments.id })
    .from(instruments)
    .where(eq(instruments.userId, ctx.userId))

  for (const { id } of userInstruments) await refresh(ctx, id)

  return userInstruments.length
}

export const checkpointService = { refresh, refreshAll }
