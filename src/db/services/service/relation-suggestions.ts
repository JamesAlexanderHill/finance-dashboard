import type { EventRelationType } from '~/db/schema'

// The minimum an event needs to be ranked as a suggestion. Real candidates carry
// the full decorated event (account, legs, instrument) which `T` preserves.
export type SuggestionEvent = {
  id: string
  accountId: string
  effectiveAt: Date
  legs: { unitCount: bigint }[]
}

// A transfer's two sides post within a few days of each other.
export const TRANSFER_WINDOW_DAYS = 4
// A reimbursement/refund arrives within a fortnight of the expense.
export const REIMBURSEMENT_WINDOW_DAYS = 14

const MS_PER_DAY = 86_400_000

function netUnitCount(legs: { unitCount: bigint }[]): bigint {
  return legs.reduce((sum, l) => sum + BigInt(l.unitCount), 0n)
}

// Whole-calendar-day difference a − b (UTC), so "within N days" matches user
// intuition regardless of intraday timestamps.
function calendarDayDiff(a: Date, b: Date): number {
  const da = Date.UTC(a.getUTCFullYear(), a.getUTCMonth(), a.getUTCDate())
  const db = Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate())
  return Math.round((da - db) / MS_PER_DAY)
}

/**
 * Rank likely counterpart events to link to `anchor` for a given relation type.
 * Pure — candidates are pre-fetched within a date window; this applies the
 * per-type matching rules and ordering.
 *
 *  - **transfer** — an opposite-signed event of the *same magnitude* in a
 *    *different account*, within ±4 days. Catches same-currency internal
 *    transfers (the two sides net to zero).
 *  - **reimbursement** — an inflow within 14 days *after* an expense, *smaller*
 *    than the expense (you are paid back for others' share, not your own).
 *  - **refund** — like a reimbursement, but the inflow may *equal* the expense
 *    (a full refund).
 *
 * Reimbursement/refund suggestions only apply when `anchor` is an expense
 * (net outflow); transfer suggestions work from either side.
 */
export function suggestRelations<T extends SuggestionEvent>(
  anchor: SuggestionEvent,
  candidates: T[],
  type: EventRelationType,
  limit = 6,
): T[] {
  const anchorNet = netUnitCount(anchor.legs)

  if (type === 'transfer') {
    if (anchorNet === 0n) return []
    return candidates
      .filter((c) => c.accountId !== anchor.accountId)
      .filter((c) => netUnitCount(c.legs) === -anchorNet)
      .filter(
        (c) => Math.abs(calendarDayDiff(c.effectiveAt, anchor.effectiveAt)) <= TRANSFER_WINDOW_DAYS,
      )
      .sort(
        (a, b) =>
          Math.abs(calendarDayDiff(a.effectiveAt, anchor.effectiveAt)) -
          Math.abs(calendarDayDiff(b.effectiveAt, anchor.effectiveAt)),
      )
      .slice(0, limit)
  }

  // reimbursement / refund — anchor must be an expense (net outflow).
  if (anchorNet >= 0n) return []
  const expense = -anchorNet
  const allowEqual = type === 'refund'

  return candidates
    .filter((c) => {
      const cn = netUnitCount(c.legs)
      if (cn <= 0n) return false // must be an inflow
      return allowEqual ? cn <= expense : cn < expense
    })
    .filter((c) => {
      const days = calendarDayDiff(c.effectiveAt, anchor.effectiveAt)
      return days >= 0 && days <= REIMBURSEMENT_WINDOW_DAYS // on/after the expense, within a fortnight
    })
    .sort((a, b) => {
      const da = calendarDayDiff(a.effectiveAt, anchor.effectiveAt)
      const db = calendarDayDiff(b.effectiveAt, anchor.effectiveAt)
      if (da !== db) return da - db // soonest after the expense first
      // tie-break: larger repayment first
      return netUnitCount(b.legs) > netUnitCount(a.legs) ? 1 : -1
    })
    .slice(0, limit)
}
