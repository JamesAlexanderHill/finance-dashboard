import { eq, and } from 'drizzle-orm'
import { db } from '~/db'
import { repaymentStatements } from '~/db/schema'

const linkWith = {
  statement: { with: { account: true as const } },
}

/** All statements a given repayment event settles, decorated for display. */
export async function queryRepaymentStatementsForEvent(workspaceId: string, repaymentEventId: string) {
  return db.query.repaymentStatements.findMany({
    where: and(
      eq(repaymentStatements.workspaceId, workspaceId),
      eq(repaymentStatements.repaymentEventId, repaymentEventId),
    ),
    with: linkWith,
  })
}

/** All repayments settling a given statement, decorated for display. */
export async function queryRepaymentStatementsForStatement(workspaceId: string, statementId: string) {
  return db.query.repaymentStatements.findMany({
    where: and(
      eq(repaymentStatements.workspaceId, workspaceId),
      eq(repaymentStatements.statementId, statementId),
    ),
    with: { repaymentEvent: { with: { account: true } } },
  })
}

/**
 * All events in the workspace that are the "repayment" side of at least one
 * repayment_statements link. Used by the analytics dashboard rule to exclude
 * settlement legs from spend/income even if a leg was mistakenly categorised.
 */
export async function queryRepaymentEventIds(workspaceId: string): Promise<string[]> {
  const rows = await db
    .selectDistinct({ repaymentEventId: repaymentStatements.repaymentEventId })
    .from(repaymentStatements)
    .where(eq(repaymentStatements.workspaceId, workspaceId))
  return rows.map((r) => r.repaymentEventId)
}

export async function upsertRepaymentStatement(
  workspaceId: string,
  data: { repaymentEventId: string; statementId: string; amountApplied: bigint },
) {
  await db
    .insert(repaymentStatements)
    .values({ workspaceId, ...data })
    .onConflictDoUpdate({
      target: [repaymentStatements.repaymentEventId, repaymentStatements.statementId],
      set: { amountApplied: data.amountApplied },
    })
}

export async function deleteRepaymentStatement(
  workspaceId: string,
  params: { repaymentEventId: string; statementId: string },
) {
  await db
    .delete(repaymentStatements)
    .where(
      and(
        eq(repaymentStatements.workspaceId, workspaceId),
        eq(repaymentStatements.repaymentEventId, params.repaymentEventId),
        eq(repaymentStatements.statementId, params.statementId),
      ),
    )
}
