import { describe, expect, test } from 'bun:test'
import {
  resolveLegCategoryShares,
  resolveEventCategoryBreakdown,
  type RollupLeg,
} from '../category-rollup'

describe('resolveLegCategoryShares', () => {
  test('a leg without line items uses its own category as the sole share', () => {
    const leg: RollupLeg = { categoryId: 'coffee', unitCount: -500n, lineItems: [] }
    expect(resolveLegCategoryShares(leg)).toEqual([{ categoryId: 'coffee', amount: -500n }])
  })

  test('a leg with no category and no line items is a single uncategorized share', () => {
    const leg: RollupLeg = { categoryId: null, unitCount: -500n, lineItems: [] }
    expect(resolveLegCategoryShares(leg)).toEqual([{ categoryId: null, amount: -500n }])
  })

  test('a leg with line items uses them and ignores its own category', () => {
    const leg: RollupLeg = {
      categoryId: 'groceries', // stale/irrelevant once line items exist
      unitCount: -12750n,
      lineItems: [
        { categoryId: 'groceries', unitCount: -4850n },
        { categoryId: 'produce', unitCount: -5200n },
        { categoryId: 'dairy', unitCount: -2700n },
      ],
    }
    expect(resolveLegCategoryShares(leg)).toEqual([
      { categoryId: 'groceries', amount: -4850n },
      { categoryId: 'produce', amount: -5200n },
      { categoryId: 'dairy', amount: -2700n },
    ])
  })

  test('a line item with no category resolves to an uncategorized share', () => {
    const leg: RollupLeg = {
      categoryId: 'groceries',
      unitCount: -1000n,
      lineItems: [{ categoryId: null, unitCount: -1000n }],
    }
    expect(resolveLegCategoryShares(leg)).toEqual([{ categoryId: null, amount: -1000n }])
  })
})

describe('resolveEventCategoryBreakdown', () => {
  test('uses its own categorized legs and ignores children even if supplied', () => {
    const event = { legs: [{ categoryId: 'travel', unitCount: -20000n, lineItems: [] }] }
    const children = [{ legs: [{ categoryId: 'dining', unitCount: -3000n, lineItems: [] }] }]
    expect(resolveEventCategoryBreakdown(event, children)).toEqual([
      { categoryId: 'travel', amount: -20000n },
    ])
  })

  test('falls back to children when every own leg is uncategorized', () => {
    const event = { legs: [{ categoryId: null, unitCount: -50000n, lineItems: [] }] }
    const children = [
      { legs: [{ categoryId: 'groceries', unitCount: -30000n, lineItems: [] }] },
      { legs: [{ categoryId: 'dining', unitCount: -20000n, lineItems: [] }] },
    ]
    expect(resolveEventCategoryBreakdown(event, children)).toEqual([
      { categoryId: 'groceries', amount: -30000n },
      { categoryId: 'dining', amount: -20000n },
    ])
  })

  test('with no children supplied and no own category, returns the uncategorized own shares', () => {
    const event = { legs: [{ categoryId: null, unitCount: -50000n, lineItems: [] }] }
    expect(resolveEventCategoryBreakdown(event)).toEqual([{ categoryId: null, amount: -50000n }])
  })

  test('a partially categorized event (any own share categorized) does not fall back', () => {
    const event = {
      legs: [
        { categoryId: 'travel', unitCount: -20000n, lineItems: [] },
        { categoryId: null, unitCount: -1000n, lineItems: [] },
      ],
    }
    const children = [{ legs: [{ categoryId: 'dining', unitCount: -3000n, lineItems: [] }] }]
    expect(resolveEventCategoryBreakdown(event, children)).toEqual([
      { categoryId: 'travel', amount: -20000n },
      { categoryId: null, amount: -1000n },
    ])
  })
})
