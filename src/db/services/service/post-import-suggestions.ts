import { and, eq } from 'drizzle-orm'
import { db } from '~/db'
import { events } from '~/db/schema'
import type { RequestContext } from '../utils/context'
import { relationService } from './relation'
import { subEventService } from './sub-event'

export interface PostImportSuggestion {
  parentEventId: string
  parentDescription: string
  transferCandidateId: string
  transferCandidateDescription: string
  subEventCandidates: { id: string; description: string; effectiveAt: Date; unitCount: bigint }[]
  candidateSum: bigint
}

/**
 * For each just-committed event, checks whether it looks like the anchor
 * outflow of a repayment: a net outflow with exactly one strong `transfer`
 * suggestion (an unambiguous signal — no guessing among several candidates).
 * When found, uses that candidate's account directly to suggest a prior
 * statement-period sub-event grouping. Nothing is linked here — this only
 * proposes groups for the import wizard's post-commit review step, which the
 * user approves or skips.
 */
async function suggestPostImportLinks(
  ctx: RequestContext,
  eventIds: string[],
): Promise<PostImportSuggestion[]> {
  const results: PostImportSuggestion[] = []

  for (const eventId of eventIds) {
    const event = await db.query.events.findFirst({
      where: and(eq(events.id, eventId), eq(events.workspaceId, ctx.workspaceId)),
      with: { legs: true },
    })
    if (!event) continue

    const net = event.legs.reduce((sum, l) => sum + l.unitCount, 0n)
    if (net >= 0n) continue // only anchor outflows are repayment candidates

    const transferCandidates = await relationService.suggest(ctx, { eventId, relationType: 'transfer' })
    if (transferCandidates.length !== 1) continue // only act on an unambiguous match
    const transferCandidate = transferCandidates[0]

    const { candidates, candidateSum } = await subEventService.suggestGroupings(ctx, {
      parentEventId: eventId,
      pairedAccountId: transferCandidate.accountId,
    })
    if (candidates.length === 0) continue

    results.push({
      parentEventId: event.id,
      parentDescription: event.description,
      transferCandidateId: transferCandidate.id,
      transferCandidateDescription: transferCandidate.description,
      subEventCandidates: candidates.map((c) => ({
        id: c.id,
        description: c.description,
        effectiveAt: c.effectiveAt,
        unitCount: c.legs.reduce((sum, l) => sum + l.unitCount, 0n),
      })),
      candidateSum,
    })
  }

  return results
}

export const postImportSuggestionsService = { suggestPostImportLinks }
