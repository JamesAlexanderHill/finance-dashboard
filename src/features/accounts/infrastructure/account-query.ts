import { eq, and, inArray, count } from 'drizzle-orm'
import { db } from '~/core/database'
import { accounts } from '~/core/database/schema'
import type { PaginationOptions } from '~/core/database/pagination'

type QueryAccountsOpts = PaginationOptions & {
  accountIds?: string[]
}

export async function queryAccountsByWorkspace(workspaceId: string, opts: QueryAccountsOpts = {}) {
  const { limit = 1000, offset = 0, accountIds } = opts

  const where = and(
    eq(accounts.workspaceId, workspaceId),
    accountIds?.length ? inArray(accounts.id, accountIds) : undefined,
  )

  const [data, [{ total }]] = await Promise.all([
    db.query.accounts.findMany({
      where,
      limit,
      offset,
      orderBy: accounts.createdAt,
      with: { instruments: true },
    }),
    db.select({ total: count() }).from(accounts).where(where),
  ])

  return { data, total }
}

export async function queryAccountById(workspaceId: string, accountId: string) {
  const [account] = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.id, accountId), eq(accounts.workspaceId, workspaceId)))

  return account ?? null
}
