import { and, eq, inArray } from 'drizzle-orm'
import { db } from '~/db'
import { accounts, events } from '~/db/schema'
import type { RequestContext } from '../utils/context'
import { importService, type CommitImportParams } from './import'
import { relationService } from './relation'
import { subEventService } from './sub-event'
import { suggestRelations, assignTransferParentChild } from './relation-suggestions'

export interface CommitRepaymentImportParams extends Omit<CommitImportParams, 'accountId'> {
  /** The repayment event these imported transactions decompose. */
  parentEventId: string
  /** The credit account being imported into — must have `isCredit: true`. */
  accountId: string
}

export interface RepaymentImportResult {
  fileId: string
  importedCount: number
  skippedCount: number
  restoredCount: number
  errorCount: number
  /** The imported event auto-linked as the transfer counterpart, if one was found. */
  transferMatchId: string | null
  transferMatchDescription: string | null
  /** All other imported events, linked as sub-events of the parent. */
  subEventChildIds: string[]
}

/**
 * Imports a statement into a credit account on behalf of a specific
 * repayment event: every committed event becomes a sub-event of
 * `parentEventId`, except the one that looks like the repayment's own
 * transfer counterpart (an opposite-signed, same-magnitude event within a
 * few days — the same rule the event drawer's relation picker uses), which
 * is linked as an `eventRelations` transfer instead so it nets out of
 * spend/income analytics rather than showing up as a "purchase".
 */
async function commit(
  ctx: RequestContext,
  params: CommitRepaymentImportParams,
): Promise<RepaymentImportResult> {
  const { parentEventId, ...importParams } = params
  const { workspaceId } = ctx

  const parent = await db.query.events.findFirst({
    where: and(eq(events.id, parentEventId), eq(events.workspaceId, workspaceId)),
    with: { legs: true },
  })
  if (!parent) throw new Error(`Event not found: ${parentEventId}`)

  const targetAccount = await db.query.accounts.findFirst({
    where: and(eq(accounts.id, importParams.accountId), eq(accounts.workspaceId, workspaceId)),
  })
  if (!targetAccount) throw new Error(`Account not found: ${importParams.accountId}`)
  if (!targetAccount.isCredit) throw new Error('Target account is not marked as a credit account')
  if (targetAccount.id === parent.accountId) {
    throw new Error('Cannot import a repayment statement into the repayment\'s own account')
  }

  const { fileId, eventIds, importedCount, skippedCount, restoredCount, errorCount } =
    await importService.commitImport(ctx, importParams)

  const baseResult = { fileId, importedCount, skippedCount, restoredCount, errorCount }
  if (eventIds.length === 0) {
    return { ...baseResult, transferMatchId: null, transferMatchDescription: null, subEventChildIds: [] }
  }

  const committed = await db.query.events.findMany({
    where: inArray(events.id, eventIds),
    with: { legs: true },
  })

  const [transferMatch] = suggestRelations(parent, committed, 'transfer', 1)

  let transferMatchId: string | null = null
  let transferMatchDescription: string | null = null
  if (transferMatch) {
    const pair = assignTransferParentChild(parent, transferMatch)
    await relationService.create(ctx, { ...pair, relationType: 'transfer' })
    transferMatchId = transferMatch.id
    transferMatchDescription = transferMatch.description
  }

  const subEventChildIds = eventIds.filter((id) => id !== transferMatchId)
  if (subEventChildIds.length > 0) {
    await subEventService.link(ctx, { parentEventId, childEventIds: subEventChildIds })
  }

  return { ...baseResult, transferMatchId, transferMatchDescription, subEventChildIds }
}

export const repaymentImportService = { commit }
