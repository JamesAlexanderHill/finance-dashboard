import { describe, expect, test } from 'bun:test'
import { balanceColorClass, formatBalance, formatChange } from '~/lib/format'
import type { Instrument } from '~/db/schema'

// Intl's `currencyDisplay: 'code'` separates the code from the amount with a
// non-breaking space (U+00A0), not a regular space.
const NBSP = ' '

const aud: Instrument = {
  id: '1',
  workspaceId: 'w1',
  accountId: 'a1',
  name: 'Australian Dollar',
  ticker: 'AUD',
  exponent: 2,
  positiveColor: null,
  negativeColor: null,
  neutralColor: null,
}

const vhy: Instrument = {
  id: '2',
  workspaceId: 'w1',
  accountId: 'a1',
  name: 'Vanguard High Yield ETF',
  ticker: 'VHY',
  exponent: 0,
  positiveColor: null,
  negativeColor: null,
  neutralColor: null,
}

describe('formatBalance', () => {
  test('formats a positive AUD balance', () => {
    expect(formatBalance(12345n, aud)).toBe(`AUD${NBSP}123.45`)
  })

  test('formats a negative AUD balance', () => {
    expect(formatBalance(-6789n, aud)).toBe(`-AUD${NBSP}67.89`)
  })

  test('formats whole-unit instruments (exponent 0)', () => {
    expect(formatBalance(1000n, vhy)).toBe(`VHY${NBSP}1,000`)
    expect(formatBalance(-500n, vhy)).toBe(`-VHY${NBSP}500`)
  })

  test('handles small negative magnitudes (regression: < 1 major unit)', () => {
    expect(formatBalance(-5n, aud)).toBe(`-AUD${NBSP}0.05`)
  })

  test('converts to another currency for display when convertTo is provided', () => {
    expect(
      formatBalance(1000n, vhy, {
        convertTo: { ticker: 'AUD', exponent: 2, conversionRate: 45 },
      }),
    ).toBe(`AUD${NBSP}45,000.00`)
  })
})

describe('formatChange', () => {
  test('prefixes positive changes with + (regression: nested numberFormatOptions must be applied)', () => {
    expect(formatChange(12345n, aud)).toBe(`+AUD${NBSP}123.45`)
  })

  test('prefixes negative changes with -', () => {
    expect(formatChange(-6789n, aud)).toBe(`-AUD${NBSP}67.89`)
  })

  test('zero change has no sign', () => {
    expect(formatChange(0n, aud)).toBe(`AUD${NBSP}0.00`)
  })
})

describe('balanceColorClass', () => {
  test('green for positive, red for negative, neutral for zero', () => {
    expect(balanceColorClass(100n)).toContain('green')
    expect(balanceColorClass(-100n)).toContain('red')
    expect(balanceColorClass(0n)).not.toContain('green')
    expect(balanceColorClass(0n)).not.toContain('red')
  })
})
