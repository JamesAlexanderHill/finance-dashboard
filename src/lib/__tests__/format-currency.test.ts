import { describe, expect, test } from 'bun:test'
import { formatCurrency, formatMajorAmount } from '~/lib/format-currency'

describe('formatCurrency', () => {
  test('formats minor units (cents) as AUD by default', () => {
    expect(formatCurrency(12345n)).toBe('$123.45')
    expect(formatCurrency(-6789n)).toBe('-$67.89')
    expect(formatCurrency(0n)).toBe('$0.00')
  })

  test('respects a custom exponent (e.g. 0 for whole-unit instruments)', () => {
    expect(formatCurrency(1000n, { exponent: 0, ticker: 'VHY' })).toBe('VHY 1,000')
  })

  test('handles small negative magnitudes (regression: < 1 major unit)', () => {
    expect(formatCurrency(-5n)).toBe('-$0.05')
  })
})

describe('formatMajorAmount', () => {
  test('formats a major-unit number as currency', () => {
    expect(formatMajorAmount(123.45, 'AUD')).toBe('$123.45')
  })

  test('compact mode abbreviates large numbers', () => {
    expect(formatMajorAmount(1234, 'AUD', { compact: true })).toBe('$1.2K')
  })

  test('falls back gracefully for an invalid currency code', () => {
    expect(() => formatMajorAmount(123.45, 'NOTACODE')).not.toThrow()
  })
})
