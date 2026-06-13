import { eq, and } from 'drizzle-orm'
import { db } from '~/db'
import { workspaces, instruments, instrumentRates } from '~/db/schema'
import type { InstrumentRate, RateSource } from '~/db/schema'
import type { RequestContext } from '../utils/context'
import { queryInstrumentById } from '../query/instrument'
import { queryLatestExchangeRate, queryRatesForInstruments } from '../query/rate'

export type CurrentRate = { rate: number; asOf: Date; source: RateSource }

// manual takes priority over transaction
function pickRate(rows: InstrumentRate[]): CurrentRate | null {
  const manual = rows.find((r) => r.source === 'manual')
  const txn = rows.find((r) => r.source === 'transaction')
  const chosen = manual ?? txn
  return chosen ? { rate: chosen.rate, asOf: chosen.asOf, source: chosen.source } : null
}

/**
 * Recomputes the `source: 'transaction'` rate for an instrument from its
 * latest 2-leg exchange/trade against the workspace's home currency. Any
 * `source: 'manual'` rate is left untouched.
 */
async function refresh(ctx: RequestContext, instrumentId: string): Promise<void> {
  const instrument = await queryInstrumentById(ctx.workspaceId, instrumentId)
  if (!instrument) return

  const [workspace] = await db
    .select({ homeCurrencyCode: workspaces.homeCurrencyCode })
    .from(workspaces)
    .where(eq(workspaces.id, ctx.workspaceId))
  if (!workspace) return

  const latest = instrument.ticker === workspace.homeCurrencyCode
    ? null
    : await queryLatestExchangeRate(ctx.workspaceId, instrumentId, workspace.homeCurrencyCode)

  await db.transaction(async (tx) => {
    await tx.delete(instrumentRates).where(and(
      eq(instrumentRates.workspaceId, ctx.workspaceId),
      eq(instrumentRates.instrumentId, instrumentId),
      eq(instrumentRates.source, 'transaction'),
    ))
    if (latest) {
      await tx.insert(instrumentRates).values({
        workspaceId: ctx.workspaceId,
        instrumentId,
        rate: latest.rate,
        asOf: latest.asOf,
        source: 'transaction',
      })
    }
  })
}

async function refreshAll(ctx: RequestContext): Promise<number> {
  const workspaceInstruments = await db.select({ id: instruments.id }).from(instruments).where(eq(instruments.workspaceId, ctx.workspaceId))
  for (const { id } of workspaceInstruments) await refresh(ctx, id)
  return workspaceInstruments.length
}

async function setManualRate(ctx: RequestContext, instrumentId: string, rate: number): Promise<void> {
  await db.insert(instrumentRates)
    .values({ workspaceId: ctx.workspaceId, instrumentId, rate, asOf: new Date(), source: 'manual' })
    .onConflictDoUpdate({
      target: [instrumentRates.instrumentId, instrumentRates.source],
      set: { rate, asOf: new Date() },
    })
}

async function getRate(ctx: RequestContext, instrumentId: string): Promise<CurrentRate | null> {
  const rows = await queryRatesForInstruments(ctx.workspaceId, [instrumentId])
  return pickRate(rows)
}

async function getRates(ctx: RequestContext, instrumentIds: string[]): Promise<Map<string, CurrentRate>> {
  const rows = await queryRatesForInstruments(ctx.workspaceId, instrumentIds)

  const byInstrument = new Map<string, InstrumentRate[]>()
  for (const row of rows) {
    byInstrument.set(row.instrumentId, [...(byInstrument.get(row.instrumentId) ?? []), row])
  }

  const result = new Map<string, CurrentRate>()
  for (const [instrumentId, instrumentRows] of byInstrument) {
    const picked = pickRate(instrumentRows)
    if (picked) result.set(instrumentId, picked)
  }
  return result
}

export const rateService = { refresh, refreshAll, setManualRate, getRate, getRates }
