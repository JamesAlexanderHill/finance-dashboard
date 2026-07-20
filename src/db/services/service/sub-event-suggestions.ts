// Pure ranking logic for sub-event grouping suggestions — mirrors the shape
// of relation-suggestions.ts. Given a prospective parent event (e.g. a card
// repayment) and a set of candidate events from the paired account, returns
// the likely prior-statement purchases for the user to review and approve.
// No I/O — candidates are pre-fetched within a date+account window; this
// applies the statement-period filter and ordering.

export type SubEventCandidate = {
  id: string
  effectiveAt: Date
  legs: { unitCount: bigint }[]
}

// Width of the statement window scanned for candidates — generous vs. a
// typical ~30-day billing cycle.
export const STATEMENT_PERIOD_DAYS = 35
// Gap between a statement's closing date and the day the repayment posts.
export const STATEMENT_LOOKBACK_DAYS = 2

const MS_PER_DAY = 86_400_000

function netUnitCount(legs: { unitCount: bigint }[]): bigint {
  return legs.reduce((sum, l) => sum + BigInt(l.unitCount), 0n)
}

export function statementWindow(parentEffectiveAt: Date): { start: Date; end: Date } {
  const end = new Date(parentEffectiveAt.getTime() - STATEMENT_LOOKBACK_DAYS * MS_PER_DAY)
  const start = new Date(end.getTime() - STATEMENT_PERIOD_DAYS * MS_PER_DAY)
  return { start, end }
}

/**
 * Rank likely sub-event candidates for a repayment-style parent. Unlike
 * `suggestRelations`'s top-N ranking, this returns the *whole* windowed,
 * net-outflow candidate set (sorted oldest-first) plus a `candidateSum` for a
 * soft sanity check against the parent's own magnitude — statement totals
 * rarely reconcile exactly (fees, interest, carried balance), so nothing is
 * auto-pruned to "the subset that sums right"; the user checks/unchecks in
 * the picker.
 *
 * Candidates are assumed to already be scoped to the paired account and the
 * statement window (see `statementWindow`) and to exclude events already
 * linked as someone else's sub-event child — the caller (`querySubEventCandidates`)
 * applies those filters at the query level. This function only additionally
 * restricts to net outflows (purchases, not the card's own credits/refunds —
 * a documented v1 limitation) and sorts.
 */
export function suggestSubEventGroup<T extends SubEventCandidate>(
  candidates: T[],
): { candidates: T[]; candidateSum: bigint } {
  const outflows = candidates
    .filter((c) => netUnitCount(c.legs) < 0n)
    .sort((a, b) => a.effectiveAt.getTime() - b.effectiveAt.getTime())

  const candidateSum = outflows.reduce((sum, c) => sum + netUnitCount(c.legs), 0n)

  return { candidates: outflows, candidateSum }
}
