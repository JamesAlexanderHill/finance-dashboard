import { eq, and } from 'drizzle-orm'
import { db } from '~/db'
import { accounts } from '~/db/schema'
import type { RequestContext } from '../utils/context'
import { buildPaginatedResult, type PaginationOptions } from '../utils/pagination'
import { queryAccountsByUser, queryAccountById } from '../query/account'

type ListAccountsOptions = PaginationOptions & {
  accountIds?: string[]
}

async function list(ctx: RequestContext, opts: ListAccountsOptions = {}) {
  const { limit = 1000, offset = 0 } = opts
  const { data, total } = await queryAccountsByUser(ctx.userId, opts)
  return buildPaginatedResult(data, total, limit, offset)
}

async function create(ctx: RequestContext, data: { name: string }) {
  const [account] = await db
    .insert(accounts)
    .values({ userId: ctx.userId, name: data.name.trim() })
    .returning()
  return account
}

async function update(
  ctx: RequestContext,
  accountId: string,
  data: { name: string; defaultInstrumentId: string | null },
) {
  const existing = await queryAccountById(ctx.userId, accountId)
  if (!existing) throw new Error(`Account not found: ${accountId}`)

  await db
    .update(accounts)
    .set({ name: data.name.trim(), defaultInstrumentId: data.defaultInstrumentId || null })
    .where(and(eq(accounts.id, accountId), eq(accounts.userId, ctx.userId)))
}

async function getById(ctx: RequestContext, accountId: string) {
  return queryAccountById(ctx.userId, accountId)
}

export const accountService = { getById, list, create, update }
