import { describe, expect, test } from 'bun:test'
import { ddmmyyyyToIsoZ } from '../dates'

describe('ddmmyyyyToIsoZ', () => {
  test('converts DD/MM/YYYY to an ISO UTC midnight timestamp', () => {
    expect(ddmmyyyyToIsoZ('01/02/2025')).toBe('2025-02-01T00:00:00Z')
  })

  test('trims surrounding whitespace', () => {
    expect(ddmmyyyyToIsoZ('  25/12/2024  ')).toBe('2024-12-25T00:00:00Z')
  })

  test('throws on an invalid date format', () => {
    expect(() => ddmmyyyyToIsoZ('2025-02-01')).toThrow('Invalid date')
  })
})
