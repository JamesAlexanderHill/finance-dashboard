import { eq, and } from 'drizzle-orm'
import { db } from '~/db'
import { accounts } from '~/db/schema'
import type { AccountColorName } from '~/lib/chart-colors'
import type { RequestContext } from '../utils/context'
import { buildPaginatedResult, type PaginationOptions } from '../utils/pagination'
import { queryAccountsByWorkspace, queryAccountById, queryCreditAccounts } from '../query/account'

type ListAccountsOptions = PaginationOptions & {
  accountIds?: string[]
}

async function list(ctx: RequestContext, opts: ListAccountsOptions = {}) {
  const { limit = 1000, offset = 0 } = opts
  const { data, total } = await queryAccountsByWorkspace(ctx.workspaceId, opts)
  return buildPaginatedResult(data, total, limit, offset)
}

async function create(ctx: RequestContext, data: { name: string }) {
  const [account] = await db
    .insert(accounts)
    .values({ workspaceId: ctx.workspaceId, name: data.name.trim() })
    .returning()
  return account
}

async function update(
  ctx: RequestContext,
  accountId: string,
  data: {
    name: string
    defaultInstrumentId: string | null
    color?: AccountColorName | null
    isCredit?: boolean
  },
) {
  const existing = await queryAccountById(ctx.workspaceId, accountId)
  if (!existing) throw new Error(`Account not found: ${accountId}`)

  await db
    .update(accounts)
    .set({
      name: data.name.trim(),
      defaultInstrumentId: data.defaultInstrumentId || null,
      color: data.color ?? null,
      isCredit: data.isCredit ?? existing.isCredit,
    })
    .where(and(eq(accounts.id, accountId), eq(accounts.workspaceId, ctx.workspaceId)))
}

async function getById(ctx: RequestContext, accountId: string) {
  return queryAccountById(ctx.workspaceId, accountId)
}

/** Credit accounts eligible as the target of a repayment import, optionally excluding one. */
async function listCredit(ctx: RequestContext, excludeAccountId?: string) {
  return queryCreditAccounts(ctx.workspaceId, excludeAccountId)
}

export const accountService = { getById, list, create, update, listCredit }
