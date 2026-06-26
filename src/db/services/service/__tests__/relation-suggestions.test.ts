import { describe, expect, test } from 'bun:test'
import { suggestRelations, type SuggestionEvent } from '../relation-suggestions'

function ev(
  id: string,
  accountId: string,
  date: string,
  ...amounts: bigint[]
): SuggestionEvent {
  return {
    id,
    accountId,
    effectiveAt: new Date(date),
    legs: amounts.map((unitCount) => ({ unitCount })),
  }
}

const ids = (events: SuggestionEvent[]) => events.map((e) => e.id)

describe('suggestRelations — transfer', () => {
  const anchor = ev('out', 'commbank', '2026-01-10T00:00:00Z', -150000n)

  test('suggests an opposite, equal-amount event in another account within 4 days', () => {
    const candidates = [
      ev('match', 'wise', '2026-01-12T00:00:00Z', 150000n),
      ev('same-account', 'commbank', '2026-01-11T00:00:00Z', 150000n),
      ev('too-far', 'wise', '2026-01-16T00:00:00Z', 150000n),
      ev('wrong-amount', 'wise', '2026-01-11T00:00:00Z', 140000n),
      ev('same-sign', 'wise', '2026-01-11T00:00:00Z', -150000n),
    ]
    expect(ids(suggestRelations(anchor, candidates, 'transfer'))).toEqual(['match'])
  })

  test('matches on the event net for multi-leg candidates', () => {
    const candidates = [ev('split', 'wise', '2026-01-11T00:00:00Z', 200000n, -50000n)] // nets +150000
    expect(ids(suggestRelations(anchor, candidates, 'transfer'))).toEqual(['split'])
  })

  test('orders closest-by-date first', () => {
    const candidates = [
      ev('far', 'wise', '2026-01-13T00:00:00Z', 150000n),
      ev('near', 'amex', '2026-01-11T00:00:00Z', 150000n),
    ]
    expect(ids(suggestRelations(anchor, candidates, 'transfer'))).toEqual(['near', 'far'])
  })

  test('returns nothing for a zero-net anchor', () => {
    const zero = ev('zero', 'commbank', '2026-01-10T00:00:00Z', 100n, -100n)
    expect(suggestRelations(zero, [ev('x', 'wise', '2026-01-10T00:00:00Z', 0n)], 'transfer')).toEqual([])
  })
})

describe('suggestRelations — reimbursement', () => {
  const expense = ev('dinner', 'amex', '2026-01-10T00:00:00Z', -30000n)

  test('suggests a smaller inflow within 14 days after the expense', () => {
    const candidates = [
      ev('repay', 'commbank', '2026-01-15T00:00:00Z', 20000n),
      ev('same-day', 'commbank', '2026-01-10T00:00:00Z', 10000n),
      ev('before', 'commbank', '2026-01-08T00:00:00Z', 20000n),
      ev('equal', 'commbank', '2026-01-12T00:00:00Z', 30000n),
      ev('greater', 'commbank', '2026-01-12T00:00:00Z', 40000n),
      ev('too-late', 'commbank', '2026-01-25T00:00:00Z', 20000n),
      ev('outflow', 'commbank', '2026-01-12T00:00:00Z', -20000n),
    ]
    // 'same-day' (diff 0) sorts before 'repay' (diff 5).
    expect(ids(suggestRelations(expense, candidates, 'reimbursement'))).toEqual(['same-day', 'repay'])
  })

  test('returns nothing when the anchor is not an expense', () => {
    const inflow = ev('inflow', 'commbank', '2026-01-10T00:00:00Z', 5000n)
    const candidates = [ev('x', 'amex', '2026-01-11T00:00:00Z', 1000n)]
    expect(suggestRelations(inflow, candidates, 'reimbursement')).toEqual([])
  })
})

describe('suggestRelations — refund', () => {
  const purchase = ev('purchase', 'amex', '2026-01-10T00:00:00Z', -8000n)

  test('allows an equal-amount inflow (full refund) but not a larger one', () => {
    const candidates = [
      ev('full', 'amex', '2026-01-12T00:00:00Z', 8000n),
      ev('over', 'amex', '2026-01-12T00:00:00Z', 9000n),
    ]
    expect(ids(suggestRelations(purchase, candidates, 'refund'))).toEqual(['full'])
  })
})
