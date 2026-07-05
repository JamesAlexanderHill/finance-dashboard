import { eq, and } from 'drizzle-orm'
import { db } from '~/db'
import { events, statements } from '~/db/schema'
import type { RequestContext } from '../utils/context'
import {
  queryRepaymentStatementsForEvent,
  upsertRepaymentStatement,
  deleteRepaymentStatement,
} from '../query/repayment-statement'

async function assertEventInWorkspace(workspaceId: string, eventId: string) {
  const [row] = await db
    .select({ id: events.id })
    .from(events)
    .where(and(eq(events.id, eventId), eq(events.workspaceId, workspaceId)))
  if (!row) throw new Error(`Event not found: ${eventId}`)
}

async function assertStatementInWorkspace(workspaceId: string, statementId: string) {
  const [row] = await db
    .select({ id: statements.id })
    .from(statements)
    .where(and(eq(statements.id, statementId), eq(statements.workspaceId, workspaceId)))
  if (!row) throw new Error(`Statement not found: ${statementId}`)
}

async function listForEvent(ctx: RequestContext, repaymentEventId: string) {
  return queryRepaymentStatementsForEvent(ctx.workspaceId, repaymentEventId)
}

/** Link (or re-link, updating the amount) a repayment event to a statement it settles. */
async function link(
  ctx: RequestContext,
  params: { repaymentEventId: string; statementId: string; amountApplied: string },
) {
  const { repaymentEventId, statementId, amountApplied } = params
  await assertEventInWorkspace(ctx.workspaceId, repaymentEventId)
  await assertStatementInWorkspace(ctx.workspaceId, statementId)

  await upsertRepaymentStatement(ctx.workspaceId, {
    repaymentEventId,
    statementId,
    amountApplied: BigInt(amountApplied),
  })
}

async function unlink(
  ctx: RequestContext,
  params: { repaymentEventId: string; statementId: string },
) {
  await deleteRepaymentStatement(ctx.workspaceId, params)
}

export const repaymentStatementService = { listForEvent, link, unlink }
