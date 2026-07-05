import { eq, and, desc, count, inArray, sql } from 'drizzle-orm'
import { db } from '~/db'
import { statements, legs } from '~/db/schema'

const statementWith = {
  account: true as const,
}

export async function queryStatementsByAccount(workspaceId: string, accountId: string) {
  return db.query.statements.findMany({
    where: and(eq(statements.workspaceId, workspaceId), eq(statements.accountId, accountId)),
    orderBy: [desc(statements.periodEnd)],
    with: statementWith,
  })
}

/** A single workspace-scoped statement, with the purchase legs tagged to it. */
export async function queryStatementById(workspaceId: string, statementId: string) {
  return db.query.statements.findFirst({
    where: and(eq(statements.id, statementId), eq(statements.workspaceId, workspaceId)),
    with: {
      ...statementWith,
      legs: { with: { event: true, instrument: true, category: true } },
      repaymentStatements: { with: { repaymentEvent: true } },
    },
  })
}

export async function queryStatementsForLinking(
  workspaceId: string,
  params: { accountId?: string; limit?: number } = {},
) {
  const { accountId, limit = 50 } = params
  return db.query.statements.findMany({
    where: and(
      eq(statements.workspaceId, workspaceId),
      accountId ? eq(statements.accountId, accountId) : undefined,
    ),
    orderBy: [desc(statements.periodEnd)],
    limit,
    with: statementWith,
  })
}

export async function insertStatement(
  workspaceId: string,
  data: { accountId: string; periodStart: Date; periodEnd: Date; closingBalance: bigint },
) {
  const [statement] = await db
    .insert(statements)
    .values({ workspaceId, ...data })
    .returning()
  return statement
}

export async function countLegsForStatement(workspaceId: string, statementId: string) {
  const [{ total }] = await db
    .select({ total: count() })
    .from(legs)
    .where(and(eq(legs.workspaceId, workspaceId), eq(legs.statementId, statementId)))
  return total
}

/** Sum of the (negative) purchase legs currently tagged to a statement, in minor units. */
export async function sumLegsForStatement(workspaceId: string, statementId: string) {
  const [row] = await db
    .select({ total: sql<string>`coalesce(sum(${legs.unitCount}), 0)` })
    .from(legs)
    .where(and(eq(legs.workspaceId, workspaceId), eq(legs.statementId, statementId)))
  return BigInt(row?.total ?? '0')
}

export async function assignLegsToStatement(
  workspaceId: string,
  statementId: string,
  legIds: string[],
) {
  if (legIds.length === 0) return
  await db
    .update(legs)
    .set({ statementId })
    .where(and(eq(legs.workspaceId, workspaceId), inArray(legs.id, legIds)))
}

export async function deleteStatement(workspaceId: string, statementId: string) {
  await db
    .delete(statements)
    .where(and(eq(statements.id, statementId), eq(statements.workspaceId, workspaceId)))
}
