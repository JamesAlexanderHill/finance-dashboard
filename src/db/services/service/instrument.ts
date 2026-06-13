import { eq, and } from 'drizzle-orm'
import { db } from '~/db'
import { instruments, instrumentCheckpoints, instrumentRates } from '~/db/schema'
import type { ChartColorName } from '~/lib/chart-colors'
import type { RequestContext } from '../utils/context'
import { buildPaginatedResult, type PaginationOptions } from '../utils/pagination'
import {
  queryInstrumentsWithBalance,
  queryInstrumentBalances,
  queryAccountBalances,
  queryInstrumentById,
  queryInstrumentBalance,
  queryInstrumentHasLegs,
  queryInstrumentBalanceHistory,
  queryInstrumentTransactionHistory,
  type BalanceHistoryRange,
  type BalanceHistoryPeriod,
} from '../query/instrument'

export type { AccountBalance, BalancePoint, BalanceHistoryRange, BalanceHistoryPeriod } from '../query/instrument'

type ListInstrumentsOptions = PaginationOptions & {
  accountIds?: string[]
}

async function list(ctx: RequestContext, opts: ListInstrumentsOptions = {}) {
  const { limit = 1000, offset = 0 } = opts
  const { data, total } = await queryInstrumentsWithBalance(ctx.workspaceId, opts)
  return buildPaginatedResult(data, total, limit, offset)
}

async function getBalances(ctx: RequestContext, accountIds?: string[]) {
  return queryInstrumentBalances(ctx.workspaceId, accountIds)
}

async function getAccountBalances(ctx: RequestContext) {
  return queryAccountBalances(ctx.workspaceId)
}

async function getById(ctx: RequestContext, instrumentId: string) {
  return queryInstrumentById(ctx.workspaceId, instrumentId)
}

async function getBalance(ctx: RequestContext, instrumentId: string): Promise<bigint> {
  return queryInstrumentBalance(ctx.workspaceId, instrumentId)
}

async function getBalanceHistory(
  ctx: RequestContext,
  instrumentId: string,
  range: BalanceHistoryRange = '30d',
  period: BalanceHistoryPeriod = 'day',
) {
  if (period === 'transaction') {
    return queryInstrumentTransactionHistory(ctx.workspaceId, instrumentId, range)
  }
  return queryInstrumentBalanceHistory(ctx.workspaceId, instrumentId, range, period)
}

async function create(
  ctx: RequestContext,
  data: { accountId: string; ticker: string; name: string; exponent: number },
) {
  const [instrument] = await db
    .insert(instruments)
    .values({
      workspaceId: ctx.workspaceId,
      accountId: data.accountId,
      ticker: data.ticker.trim().toUpperCase(),
      name: data.name.trim(),
      exponent: data.exponent,
    })
    .returning()
  return instrument
}

async function update(
  ctx: RequestContext,
  instrumentId: string,
  data: {
    name: string
    exponent: number
    positiveColor?: ChartColorName | null
    negativeColor?: ChartColorName | null
    neutralColor?: ChartColorName | null
  },
) {
  const existing = await queryInstrumentById(ctx.workspaceId, instrumentId)
  if (!existing) throw new Error(`Instrument not found: ${instrumentId}`)

  await db
    .update(instruments)
    .set({
      name: data.name.trim(),
      exponent: data.exponent,
      ...(data.positiveColor !== undefined ? { positiveColor: data.positiveColor } : {}),
      ...(data.negativeColor !== undefined ? { negativeColor: data.negativeColor } : {}),
      ...(data.neutralColor !== undefined ? { neutralColor: data.neutralColor } : {}),
    })
    .where(and(eq(instruments.id, instrumentId), eq(instruments.workspaceId, ctx.workspaceId)))
}

async function remove(ctx: RequestContext, instrumentId: string) {
  const existing = await queryInstrumentById(ctx.workspaceId, instrumentId)
  if (!existing) throw new Error(`Instrument not found: ${instrumentId}`)

  const hasLegs = await queryInstrumentHasLegs(instrumentId)
  if (hasLegs) throw new Error('Cannot delete an instrument that has associated events')

  await db.delete(instrumentCheckpoints).where(eq(instrumentCheckpoints.instrumentId, instrumentId))
  await db.delete(instrumentRates).where(eq(instrumentRates.instrumentId, instrumentId))

  await db
    .delete(instruments)
    .where(and(eq(instruments.id, instrumentId), eq(instruments.workspaceId, ctx.workspaceId)))
}

export const instrumentService = {
  getById,
  list,
  getBalances,
  getAccountBalances,
  getBalance,
  getBalanceHistory,
  create,
  update,
  delete: remove,
}
