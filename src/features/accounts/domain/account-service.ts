import { eq, and } from 'drizzle-orm'
import { db } from '~/core/database'
import { accounts } from '~/core/database/schema'
import type { AccountColorName } from '~/shared/utilities/chart-colors'
import type { RequestContext } from '~/core/session/context'
import { buildPaginatedResult, type PaginationOptions } from '~/core/database/pagination'
import { queryAccountsByWorkspace, queryAccountById } from '~/features/accounts/infrastructure/account-query'

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
  data: { name: string; defaultInstrumentId: string | null; color?: AccountColorName | null },
) {
  const existing = await queryAccountById(ctx.workspaceId, accountId)
  if (!existing) throw new Error(`Account not found: ${accountId}`)

  await db
    .update(accounts)
    .set({
      name: data.name.trim(),
      defaultInstrumentId: data.defaultInstrumentId || null,
      color: data.color ?? null,
    })
    .where(and(eq(accounts.id, accountId), eq(accounts.workspaceId, ctx.workspaceId)))
}

async function getById(ctx: RequestContext, accountId: string) {
  return queryAccountById(ctx.workspaceId, accountId)
}

export const accountService = { getById, list, create, update }
