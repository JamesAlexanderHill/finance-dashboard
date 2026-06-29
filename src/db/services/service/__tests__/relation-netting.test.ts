import { describe, expect, test } from 'bun:test'
import {
  applyRelationsToLegs,
  type NettingRelation,
} from '../relation-netting'

// Test legs carry effectiveAt (as the analytics legs do) so we can assert it is
// preserved / inherited correctly.
type Leg = {
  eventId: string
  categoryId: string | null
  unitCount: bigint
  effectiveAt: Date
}

const JAN = new Date('2026-01-10T00:00:00Z')
const FEB = new Date('2026-02-05T00:00:00Z')

function sumByCategory(legs: Leg[]): Record<string, bigint> {
  const out: Record<string, bigint> = {}
  for (const l of legs) {
    if (!l.categoryId) continue
    out[l.categoryId] = (out[l.categoryId] ?? 0n) + l.unitCount
  }
  return out
}

describe('applyRelationsToLegs', () => {
  test('leaves unrelated legs untouched', () => {
    const legs: Leg[] = [
      { eventId: 'a', categoryId: 'food', unitCount: -5000n, effectiveAt: JAN },
      { eventId: 'b', categoryId: 'salary', unitCount: 900000n, effectiveAt: JAN },
    ]
    const result = applyRelationsToLegs(legs, [], [])
    expect(result).toEqual(legs)
  })

  test('drops both legs of an internal transfer', () => {
    const legs: Leg[] = [
      { eventId: 'out', categoryId: 'transfers', unitCount: -150000n, effectiveAt: JAN },
      { eventId: 'in', categoryId: 'transfers', unitCount: 150000n, effectiveAt: JAN },
      { eventId: 'groceries', categoryId: 'food', unitCount: -5000n, effectiveAt: JAN },
    ]
    const relations: NettingRelation[] = [
      { parentEventId: 'out', childEventId: 'in', relationType: 'transfer' },
    ]
    const result = applyRelationsToLegs(legs, relations, [])
    expect(result).toHaveLength(1)
    expect(result[0].eventId).toBe('groceries')
  })

  test('nets a partial reimbursement against the parent expense category', () => {
    const legs: Leg[] = [
      { eventId: 'dinner', categoryId: 'dining', unitCount: -30000n, effectiveAt: JAN },
    ]
    const relations: NettingRelation[] = [
      { parentEventId: 'dinner', childEventId: 'repay', relationType: 'reimbursement' },
    ]
    const childLegs: Leg[] = [
      // Repayment received later, uncategorised — should still net.
      { eventId: 'repay', categoryId: null, unitCount: 20000n, effectiveAt: FEB },
    ]
    const result = applyRelationsToLegs(legs, relations, childLegs)

    expect(result).toHaveLength(2)
    // $300 spent − $200 repaid = $100 net, all under "dining".
    expect(sumByCategory(result)).toEqual({ dining: -10000n })
    // The netted inflow inherits the expense's period, not the repayment's.
    const inflow = result.find((l) => l.unitCount > 0n)!
    expect(inflow.categoryId).toBe('dining')
    expect(inflow.effectiveAt).toEqual(JAN)
  })

  test('nets a refund the same way as a reimbursement', () => {
    const legs: Leg[] = [
      { eventId: 'purchase', categoryId: 'shopping', unitCount: -8000n, effectiveAt: JAN },
    ]
    const relations: NettingRelation[] = [
      { parentEventId: 'purchase', childEventId: 'refund', relationType: 'refund' },
    ]
    const childLegs: Leg[] = [
      { eventId: 'refund', categoryId: null, unitCount: 8000n, effectiveAt: FEB },
    ]
    const result = applyRelationsToLegs(legs, relations, childLegs)
    // Fully refunded → nets to zero in "shopping".
    expect(sumByCategory(result)).toEqual({ shopping: 0n })
  })

  test('does not double count when the repayment was itself categorised', () => {
    const legs: Leg[] = [
      { eventId: 'exp', categoryId: 'dining', unitCount: -30000n, effectiveAt: JAN },
      // User mistakenly categorised the repayment as income; it appears in the base set.
      { eventId: 'repay', categoryId: 'income', unitCount: 20000n, effectiveAt: FEB },
    ]
    const relations: NettingRelation[] = [
      { parentEventId: 'exp', childEventId: 'repay', relationType: 'reimbursement' },
    ]
    const childLegs: Leg[] = [
      { eventId: 'repay', categoryId: 'income', unitCount: 20000n, effectiveAt: FEB },
    ]
    const result = applyRelationsToLegs(legs, relations, childLegs)
    // The repayment is re-attributed to "dining" exactly once; "income" disappears.
    expect(sumByCategory(result)).toEqual({ dining: -10000n })
  })

  test('uses the parent first categorised leg for multi-category parents', () => {
    const legs: Leg[] = [
      { eventId: 'trip', categoryId: 'travel', unitCount: -20000n, effectiveAt: JAN },
      { eventId: 'trip', categoryId: 'food', unitCount: -8000n, effectiveAt: JAN },
    ]
    const relations: NettingRelation[] = [
      { parentEventId: 'trip', childEventId: 'repay', relationType: 'reimbursement' },
    ]
    const childLegs: Leg[] = [
      { eventId: 'repay', categoryId: null, unitCount: 10000n, effectiveAt: FEB },
    ]
    const result = applyRelationsToLegs(legs, relations, childLegs)
    // Inflow nets into the first categorised parent leg ("travel").
    expect(sumByCategory(result)).toEqual({ travel: -10000n, food: -8000n })
  })

  test('omits a reimbursement child when the parent has no categorised leg in range', () => {
    // Parent expense is outside the date window, so it is absent from `legs`.
    const relations: NettingRelation[] = [
      { parentEventId: 'p', childEventId: 'c', relationType: 'refund' },
    ]
    const childLegs: Leg[] = [
      { eventId: 'c', categoryId: null, unitCount: 5000n, effectiveAt: JAN },
    ]
    const result = applyRelationsToLegs([], relations, childLegs)
    expect(result).toHaveLength(0)
  })

  test('transfer exclusion wins over a reimbursement link on the same event', () => {
    const legs: Leg[] = [
      { eventId: 'x', categoryId: 'dining', unitCount: -30000n, effectiveAt: JAN },
    ]
    const relations: NettingRelation[] = [
      { parentEventId: 'x', childEventId: 'y', relationType: 'transfer' },
      { parentEventId: 'x', childEventId: 'z', relationType: 'reimbursement' },
    ]
    const childLegs: Leg[] = [
      { eventId: 'z', categoryId: null, unitCount: 10000n, effectiveAt: JAN },
    ]
    const result = applyRelationsToLegs(legs, relations, childLegs)
    // Event x is a transfer participant → fully excluded, and its reimbursement
    // child is not netted against it.
    expect(result).toHaveLength(0)
  })
})
