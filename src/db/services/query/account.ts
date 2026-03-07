import { eq, and, inArray, count } from 'drizzle-orm'
import { db } from '~/db'
import { accounts } from '~/db/schema'
import type { PaginationOptions } from '../utils/pagination'

type QueryAccountsOpts = PaginationOptions & {
  accountIds?: string[]
}

export async function queryAccountsByUser(userId: string, opts: QueryAccountsOpts = {}) {
  const { limit = 1000, offset = 0, accountIds } = opts

  const where = and(
    eq(accounts.userId, userId),
    accountIds?.length ? inArray(accounts.id, accountIds) : undefined,
  )

  const [data, [{ total }]] = await Promise.all([
    db.query.accounts.findMany({ where, limit, offset, with: { instruments: true } }),
    db.select({ total: count() }).from(accounts).where(where),
  ])

  return { data, total }
}

export async function queryAccountById(userId: string, accountId: string) {
  const [account] = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.id, accountId), eq(accounts.userId, userId)))

  return account ?? null
}
