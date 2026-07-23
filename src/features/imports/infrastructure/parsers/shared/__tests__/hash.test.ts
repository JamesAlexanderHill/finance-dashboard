import { describe, expect, test } from 'bun:test'
import { rowHash } from '../hash'

describe('rowHash', () => {
  test('produces a 16-character hex string by default', () => {
    expect(rowHash(['a', 'b', 'c'])).toMatch(/^[0-9a-f]{16}$/)
  })

  test('is deterministic for the same input', () => {
    expect(rowHash(['16-Apr-2025', 'Buy', 'VAS', '10'])).toBe(rowHash(['16-Apr-2025', 'Buy', 'VAS', '10']))
  })

  test('differs when any part differs', () => {
    expect(rowHash(['a', 'b'])).not.toBe(rowHash(['a', 'c']))
  })

  test('respects a custom length', () => {
    expect(rowHash(['a', 'b'], 8)).toMatch(/^[0-9a-f]{8}$/)
  })
})
