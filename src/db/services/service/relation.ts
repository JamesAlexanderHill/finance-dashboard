import { and, eq, inArray } from 'drizzle-orm'
import { db } from '~/db'
import { eventRelations, events, type EventRelationType } from '~/db/schema'
import type { RequestContext } from '../utils/context'
import {
  queryAnchorEvent,
  queryEventsForLinking,
  queryRelationsForEvent,
  querySuggestionCandidates,
} from '../query/relation'
import {
  suggestRelations,
  REIMBURSEMENT_WINDOW_DAYS,
  TRANSFER_WINDOW_DAYS,
} from './relation-suggestions'

const DAY_MS = 86_400_000

/** Throw unless every id belongs to the caller's workspace. */
async function assertEventsInWorkspace(workspaceId: string, ids: string[]) {
  const unique = [...new Set(ids)]
  const rows = await db
    .select({ id: events.id })
    .from(events)
    .where(and(eq(events.workspaceId, workspaceId), inArray(events.id, unique)))
  if (rows.length !== unique.length) {
    throw new Error('Event not found in workspace')
  }
}

async function listForEvent(ctx: RequestContext, eventId: string) {
  return queryRelationsForEvent(ctx.workspaceId, eventId)
}

async function searchCandidates(
  ctx: RequestContext,
  params: { query?: string; excludeEventIds?: string[]; limit?: number } = {},
) {
  return queryEventsForLinking(ctx.workspaceId, params)
}

async function create(
  ctx: RequestContext,
  params: { parentEventId: string; childEventId: string; relationType: EventRelationType },
) {
  const { parentEventId, childEventId, relationType } = params
  if (parentEventId === childEventId) {
    throw new Error('Cannot relate an event to itself')
  }
  await assertEventsInWorkspace(ctx.workspaceId, [parentEventId, childEventId])

  // A (parent, child) pair is unique; re-linking the same pair updates its type.
  await db
    .insert(eventRelations)
    .values({ parentEventId, childEventId, relationType })
    .onConflictDoUpdate({
      target: [eventRelations.parentEventId, eventRelations.childEventId],
      set: { relationType },
    })
}

async function remove(
  ctx: RequestContext,
  params: { parentEventId: string; childEventId: string },
) {
  await assertEventsInWorkspace(ctx.workspaceId, [params.parentEventId, params.childEventId])
  await db
    .delete(eventRelations)
    .where(
      and(
        eq(eventRelations.parentEventId, params.parentEventId),
        eq(eventRelations.childEventId, params.childEventId),
      ),
    )
}

async function suggest(
  ctx: RequestContext,
  params: { eventId: string; relationType: EventRelationType; excludeEventIds?: string[] },
) {
  const anchor = await queryAnchorEvent(ctx.workspaceId, params.eventId)
  if (!anchor) return []

  // Fetch a window generous enough to cover both rules (±transfer days and the
  // forward reimbursement window) plus a day of slack; the pure ranker then
  // applies the exact per-type calendar-day limits.
  const anchorTime = anchor.effectiveAt.getTime()
  const start = new Date(anchorTime - (TRANSFER_WINDOW_DAYS + 1) * DAY_MS)
  const end = new Date(anchorTime + (REIMBURSEMENT_WINDOW_DAYS + 1) * DAY_MS)
  const excludeEventIds = [params.eventId, ...(params.excludeEventIds ?? [])]

  const candidates = await querySuggestionCandidates(ctx.workspaceId, {
    start,
    end,
    excludeEventIds,
  })
  return suggestRelations(anchor, candidates, params.relationType)
}

export const relationService = { listForEvent, searchCandidates, suggest, create, delete: remove }
