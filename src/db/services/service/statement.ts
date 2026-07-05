import { eq, and } from 'drizzle-orm'
import { db } from '~/db'
import { accounts } from '~/db/schema'
import type { RequestContext } from '../utils/context'
import {
  queryStatementsByAccount,
  queryStatementById,
  queryStatementsForLinking,
  insertStatement,
  countLegsForStatement,
  assignLegsToStatement,
  deleteStatement,
} from '../query/statement'

async function assertAccountInWorkspace(workspaceId: string, accountId: string) {
  const [account] = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.id, accountId), eq(accounts.workspaceId, workspaceId)))
  if (!account) throw new Error(`Account not found: ${accountId}`)
}

async function listByAccount(ctx: RequestContext, accountId: string) {
  return queryStatementsByAccount(ctx.workspaceId, accountId)
}

/** A statement with its tagged purchase legs, linked repayments, and how much remains unsettled. */
async function get(ctx: RequestContext, statementId: string) {
  const statement = await queryStatementById(ctx.workspaceId, statementId)
  if (!statement) return null

  const amountApplied = statement.repaymentStatements.reduce(
    (sum, link) => sum + link.amountApplied,
    BigInt(0),
  )
  // closingBalance is stored as a negative (outstanding debt); amountApplied is
  // the positive amount repaid against it.
  const amountRemaining = statement.closingBalance + amountApplied

  return { ...statement, amountApplied, amountRemaining }
}

async function searchCandidates(
  ctx: RequestContext,
  params: { accountId?: string; limit?: number } = {},
) {
  return queryStatementsForLinking(ctx.workspaceId, params)
}

async function create(
  ctx: RequestContext,
  data: { accountId: string; periodStart: string; periodEnd: string; closingBalance: string; legIds?: string[] },
) {
  await assertAccountInWorkspace(ctx.workspaceId, data.accountId)

  const statement = await insertStatement(ctx.workspaceId, {
    accountId: data.accountId,
    periodStart: new Date(data.periodStart),
    periodEnd: new Date(data.periodEnd),
    closingBalance: BigInt(data.closingBalance),
  })

  if (data.legIds?.length) {
    await assignLegsToStatement(ctx.workspaceId, statement.id, data.legIds)
  }

  return statement
}

async function assignLegs(ctx: RequestContext, statementId: string, legIds: string[]) {
  const statement = await queryStatementById(ctx.workspaceId, statementId)
  if (!statement) throw new Error(`Statement not found: ${statementId}`)
  await assignLegsToStatement(ctx.workspaceId, statementId, legIds)
}

async function remove(ctx: RequestContext, statementId: string) {
  const legCount = await countLegsForStatement(ctx.workspaceId, statementId)
  if (legCount > 0) {
    throw new Error('Cannot delete a statement with legs still tagged to it')
  }
  await deleteStatement(ctx.workspaceId, statementId)
}

export const statementService = {
  listByAccount,
  get,
  searchCandidates,
  create,
  assignLegs,
  delete: remove,
}
