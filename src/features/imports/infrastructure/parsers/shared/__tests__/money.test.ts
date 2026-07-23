import { describe, expect, test } from 'bun:test'
import { amountToCents } from '../money'

describe('amountToCents', () => {
  test('converts a positive amount', () => {
    expect(amountToCents('12.50')).toBe(1250)
  })

  test('converts a negative amount', () => {
    expect(amountToCents('-63.75')).toBe(-6375)
  })

  test('converts a positive amount with an explicit sign', () => {
    expect(amountToCents('+517.16')).toBe(51716)
  })

  test('strips thousands separators', () => {
    expect(amountToCents('1,200.00')).toBe(120000)
  })

  test('pads single-digit cents', () => {
    expect(amountToCents('5.1')).toBe(510)
  })

  test('handles whole-dollar amounts with no decimal point', () => {
    expect(amountToCents('100')).toBe(10000)
  })

  test('returns 0 for an empty string', () => {
    expect(amountToCents('')).toBe(0)
  })

  test('returns 0 for non-numeric input', () => {
    expect(amountToCents('abc')).toBe(0)
  })
})
