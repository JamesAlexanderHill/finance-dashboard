import { describe, expect, test } from 'bun:test'
import scaleUnit from '~/lib/scale-unit'

describe('scaleUnit', () => {
  test('converts whole-dollar minor units to major units', () => {
    expect(scaleUnit(12345n, 2)).toBe(123.45)
    expect(scaleUnit(100n, 2)).toBe(1)
    expect(scaleUnit(0n, 2)).toBe(0)
  })

  test('handles negative values', () => {
    expect(scaleUnit(-6789n, 2)).toBe(-67.89)
    expect(scaleUnit(-100n, 2)).toBe(-1)
  })

  test('handles magnitudes smaller than one major unit, including negative', () => {
    expect(scaleUnit(5n, 2)).toBe(0.05)
    expect(scaleUnit(-5n, 2)).toBe(-0.05)
    expect(scaleUnit(99n, 2)).toBe(0.99)
    expect(scaleUnit(-99n, 2)).toBe(-0.99)
  })

  test('exponent 0 (whole-unit instruments, e.g. ETF shares) is a pass-through', () => {
    expect(scaleUnit(1000n, 0)).toBe(1000)
    expect(scaleUnit(-1000n, 0)).toBe(-1000)
    expect(scaleUnit(0n, 0)).toBe(0)
  })

  test('handles larger balances without floating point drift', () => {
    expect(scaleUnit(123456789012n, 2)).toBe(1234567890.12)
    expect(scaleUnit(-123456789012n, 2)).toBe(-1234567890.12)
  })
})
