import { describe, expect, test } from 'bun:test'
import formatDate from '~/lib/format-date'

describe('formatDate', () => {
  test('formats a Date as "D MMM YYYY"', () => {
    expect(formatDate(new Date('2025-11-26T00:00:00Z'))).toBe('26 Nov 2025')
  })

  test('formats an ISO date string', () => {
    expect(formatDate('2025-01-05T00:00:00Z')).toBe('5 Jan 2025')
  })
})
