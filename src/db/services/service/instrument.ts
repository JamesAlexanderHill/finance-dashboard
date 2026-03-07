import { eq, and } from 'drizzle-orm'
import { db } from '~/db'
import { instruments } from '~/db/schema'
import type { RequestContext } from '../utils/context'
import { buildPaginatedResult, type PaginationOptions } from '../utils/pagination'
import {
  queryInstrumentsWithBalance,
  queryInstrumentBalances,
  queryAccountBalances,
  queryInstrumentById,
  queryInstrumentBalance,
  queryInstrumentHasLegs,
} from '../query/instrument'

export type { AccountBalance } from '../query/instrument'

type ListInstrumentsOptions = PaginationOptions & {
  accountIds?: string[]
}

async function list(ctx: RequestContext, opts: ListInstrumentsOptions = {}) {
  const { limit = 1000, offset = 0 } = opts
  const { data, total } = await queryInstrumentsWithBalance(ctx.userId, opts)
  return buildPaginatedResult(data, total, limit, offset)
}

async function getBalances(ctx: RequestContext, accountIds?: string[]) {
  return queryInstrumentBalances(ctx.userId, accountIds)
}

async function getAccountBalances(ctx: RequestContext) {
  return queryAccountBalances(ctx.userId)
}

async function getById(ctx: RequestContext, instrumentId: string) {
  return queryInstrumentById(ctx.userId, instrumentId)
}

async function getBalance(ctx: RequestContext, instrumentId: string): Promise<bigint> {
  return queryInstrumentBalance(ctx.userId, instrumentId)
}

async function create(
  ctx: RequestContext,
  data: { accountId: string; ticker: string; name: string; exponent: number },
) {
  const [instrument] = await db
    .insert(instruments)
    .values({
      userId: ctx.userId,
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
  data: { name: string; exponent: number },
) {
  const existing = await queryInstrumentById(ctx.userId, instrumentId)
  if (!existing) throw new Error(`Instrument not found: ${instrumentId}`)

  await db
    .update(instruments)
    .set({ name: data.name.trim(), exponent: data.exponent })
    .where(and(eq(instruments.id, instrumentId), eq(instruments.userId, ctx.userId)))
}

async function remove(ctx: RequestContext, instrumentId: string) {
  const existing = await queryInstrumentById(ctx.userId, instrumentId)
  if (!existing) throw new Error(`Instrument not found: ${instrumentId}`)

  const hasLegs = await queryInstrumentHasLegs(instrumentId)
  if (hasLegs) throw new Error('Cannot delete an instrument that has associated events')

  await db
    .delete(instruments)
    .where(and(eq(instruments.id, instrumentId), eq(instruments.userId, ctx.userId)))
}

export const instrumentService = {
  getById,
  list,
  getBalances,
  getAccountBalances,
  getBalance,
  create,
  update,
  delete: remove,
}
