import { and, eq, inArray } from 'drizzle-orm'
import { db } from '~/db'
import { events, subEventLinks } from '~/db/schema'
import type { RequestContext } from '../utils/context'
import {
  queryChildrenForParent,
  queryEventsForSubEventPicker,
  queryPairedAccountForEvent,
  queryParentForChild,
  querySubEventCandidates,
} from '../query/sub-event'
import { statementWindow, suggestSubEventGroup } from './sub-event-suggestions'

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

async function listChildren(ctx: RequestContext, parentEventId: string) {
  return queryChildrenForParent(ctx.workspaceId, parentEventId)
}

async function getParent(ctx: RequestContext, childEventId: string) {
  return queryParentForChild(ctx.workspaceId, childEventId)
}

async function searchCandidates(
  ctx: RequestContext,
  params: { query?: string; accountId?: string; excludeEventIds?: string[]; limit?: number } = {},
) {
  return queryEventsForSubEventPicker(ctx.workspaceId, params)
}

/**
 * Links `childEventIds` under `parentEventId`. Batched (the picker is
 * multi-select, unlike the single-pair relation picker). Enforces the v1
 * "no nesting past 2 levels" invariant: the parent can't itself already be a
 * child, and none of the proposed children can already be a parent elsewhere.
 */
async function link(
  ctx: RequestContext,
  params: { parentEventId: string; childEventIds: string[] },
) {
  const { parentEventId, childEventIds } = params
  if (childEventIds.length === 0) return
  if (childEventIds.includes(parentEventId)) {
    throw new Error('Cannot link an event as its own sub-event')
  }
  await assertEventsInWorkspace(ctx.workspaceId, [parentEventId, ...childEventIds])

  const [parentIsChild] = await db
    .select({ childEventId: subEventLinks.childEventId })
    .from(subEventLinks)
    .where(eq(subEventLinks.childEventId, parentEventId))
    .limit(1)
  if (parentIsChild) {
    throw new Error('Cannot link sub-events under an event that is itself a sub-event')
  }

  const anyChildIsParent = await db
    .select({ parentEventId: subEventLinks.parentEventId })
    .from(subEventLinks)
    .where(inArray(subEventLinks.parentEventId, childEventIds))
    .limit(1)
  if (anyChildIsParent.length > 0) {
    throw new Error('Cannot link an event that already has its own sub-events')
  }

  await db
    .insert(subEventLinks)
    .values(childEventIds.map((childEventId) => ({ parentEventId, childEventId })))
    .onConflictDoUpdate({
      target: subEventLinks.childEventId,
      set: { parentEventId },
    })
}

async function unlink(ctx: RequestContext, params: { childEventId: string }) {
  await assertEventsInWorkspace(ctx.workspaceId, [params.childEventId])
  await db.delete(subEventLinks).where(eq(subEventLinks.childEventId, params.childEventId))
}

/**
 * Suggests a sub-event grouping for `parentEventId`: resolves the paired
 * account (unless the caller already knows it — e.g. from a fresh transfer
 * suggestion), computes the statement window from the parent's date, fetches
 * candidates, and ranks them with the pure `suggestSubEventGroup`.
 */
async function suggestGroupings(
  ctx: RequestContext,
  params: { parentEventId: string; pairedAccountId?: string },
) {
  const parent = await db.query.events.findFirst({
    where: and(eq(events.id, params.parentEventId), eq(events.workspaceId, ctx.workspaceId)),
  })
  if (!parent) return { candidates: [], candidateSum: 0n }

  const pairedAccountId =
    params.pairedAccountId ?? (await queryPairedAccountForEvent(ctx.workspaceId, params.parentEventId))
  if (!pairedAccountId) return { candidates: [], candidateSum: 0n }

  const { start, end } = statementWindow(parent.effectiveAt)
  const candidates = await querySubEventCandidates(ctx.workspaceId, {
    accountId: pairedAccountId,
    start,
    end,
    excludeEventIds: [params.parentEventId],
  })

  return suggestSubEventGroup(candidates)
}

export const subEventService = {
  listChildren,
  getParent,
  searchCandidates,
  link,
  unlink,
  suggestGroupings,
}
