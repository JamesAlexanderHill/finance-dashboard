import { eq, and } from 'drizzle-orm'
import { db } from '~/db'
import { users, instruments, instrumentRates } from '~/db/schema'
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
 * latest 2-leg exchange/trade against the home currency. Any `source:
 * 'manual'` rate is left untouched.
 */
async function refresh(ctx: RequestContext, instrumentId: string): Promise<void> {
  const instrument = await queryInstrumentById(ctx.userId, instrumentId)
  if (!instrument) return

  const [user] = await db.select({ homeCurrencyCode: users.homeCurrencyCode }).from(users).where(eq(users.id, ctx.userId))
  if (!user) return

  const latest = instrument.ticker === user.homeCurrencyCode
    ? null
    : await queryLatestExchangeRate(ctx.userId, instrumentId, user.homeCurrencyCode)

  await db.transaction(async (tx) => {
    await tx.delete(instrumentRates).where(and(
      eq(instrumentRates.userId, ctx.userId),
      eq(instrumentRates.instrumentId, instrumentId),
      eq(instrumentRates.source, 'transaction'),
    ))
    if (latest) {
      await tx.insert(instrumentRates).values({
        userId: ctx.userId,
        instrumentId,
        rate: latest.rate,
        asOf: latest.asOf,
        source: 'transaction',
      })
    }
  })
}

async function refreshAll(ctx: RequestContext): Promise<number> {
  const userInstruments = await db.select({ id: instruments.id }).from(instruments).where(eq(instruments.userId, ctx.userId))
  for (const { id } of userInstruments) await refresh(ctx, id)
  return userInstruments.length
}

async function setManualRate(ctx: RequestContext, instrumentId: string, rate: number): Promise<void> {
  await db.insert(instrumentRates)
    .values({ userId: ctx.userId, instrumentId, rate, asOf: new Date(), source: 'manual' })
    .onConflictDoUpdate({
      target: [instrumentRates.instrumentId, instrumentRates.source],
      set: { rate, asOf: new Date() },
    })
}

async function getRate(ctx: RequestContext, instrumentId: string): Promise<CurrentRate | null> {
  const rows = await queryRatesForInstruments(ctx.userId, [instrumentId])
  return pickRate(rows)
}

async function getRates(ctx: RequestContext, instrumentIds: string[]): Promise<Map<string, CurrentRate>> {
  const rows = await queryRatesForInstruments(ctx.userId, instrumentIds)

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
