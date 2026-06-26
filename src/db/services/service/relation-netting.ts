import type { EventRelationType } from '~/db/schema'

// The minimum a leg needs for relation netting. Analytics legs carry extra
// fields (e.g. effectiveAt) which are preserved by the generic `T`.
export type NettingLeg = {
  eventId: string
  categoryId: string | null
  unitCount: bigint
}

export type NettingRelation = {
  parentEventId: string
  childEventId: string
  relationType: EventRelationType
}

/**
 * Make a set of analytics legs relation-aware before they are aggregated by
 * category. Pure — no I/O — so it can be unit-tested with synthetic data.
 *
 * Two transformations:
 *
 *  1. **Transfers are removed.** Any leg belonging to an event that participates
 *     in a `transfer` relation (as parent or child) is dropped, so moving money
 *     between your own accounts never shows up as spending or income.
 *
 *  2. **Reimbursements / refunds are netted.** For each `reimbursement` or
 *     `refund` relation, the child event's inflow legs are re-attributed onto the
 *     parent expense's category and period. A $300 dinner (parent, −300 in
 *     "dining") with a $200 repayment (child, +200) therefore nets to −100 in
 *     "dining" in the dinner's own period — rather than the repayment showing up
 *     as separate income or being ignored.
 *
 * The parent's "primary" category is taken from its first categorised leg. If the
 * parent has no categorised leg in the input set (e.g. it falls outside the
 * selected date range, or is uncategorised), its child inflow is simply omitted —
 * there is nothing to net it against.
 *
 * @param legs      Categorised legs that would normally be aggregated.
 * @param relations All event relations in scope (any type).
 * @param childLegs Legs of reimbursement/refund *child* events, included even
 *                  when uncategorised since they are netted, not aggregated
 *                  directly. May overlap with `legs`; duplicates are handled.
 */
export function applyRelationsToLegs<T extends NettingLeg>(
  legs: T[],
  relations: NettingRelation[],
  childLegs: T[],
): T[] {
  // Events whose legs are fully excluded from spend/income.
  const transferEventIds = new Set<string>()
  for (const r of relations) {
    if (r.relationType === 'transfer') {
      transferEventIds.add(r.parentEventId)
      transferEventIds.add(r.childEventId)
    }
  }

  // child event id -> parent event id, for reimbursements/refunds. A transfer
  // link on either side wins, so such relations are skipped here.
  const offsetParentByChild = new Map<string, string>()
  for (const r of relations) {
    if (r.relationType !== 'reimbursement' && r.relationType !== 'refund') continue
    if (transferEventIds.has(r.parentEventId) || transferEventIds.has(r.childEventId)) continue
    offsetParentByChild.set(r.childEventId, r.parentEventId)
  }

  // parent event id -> its first categorised leg (the category + period a child
  // inflow is netted into).
  const parentRepLeg = new Map<string, T>()
  for (const leg of legs) {
    if (leg.categoryId && !parentRepLeg.has(leg.eventId)) {
      parentRepLeg.set(leg.eventId, leg)
    }
  }

  const result: T[] = []

  // Keep every leg except transfers and reimbursement/refund child legs (the
  // latter are re-attributed below, so we drop them here to avoid double counting
  // when the child happened to be categorised).
  for (const leg of legs) {
    if (transferEventIds.has(leg.eventId)) continue
    if (offsetParentByChild.has(leg.eventId)) continue
    result.push(leg)
  }

  // Re-attribute reimbursement/refund child inflows onto the parent's category
  // and period, keeping the child's (positive) amount.
  for (const leg of childLegs) {
    if (transferEventIds.has(leg.eventId)) continue
    const parentId = offsetParentByChild.get(leg.eventId)
    if (!parentId) continue
    const rep = parentRepLeg.get(parentId)
    if (!rep) continue
    result.push({ ...rep, unitCount: leg.unitCount })
  }

  return result
}
