import { describe, expect, test } from 'bun:test'
import {
  addDays,
  addMonths,
  defaultBalanceHistoryRange,
  formatDate,
  formatRange,
  isSameDay,
  rangesEqual,
  RANGE_PRESETS,
  serializeRange,
  startOfFinancialYear,
  startOfMonth,
  startOfYear,
  toISODate,
  todayUTC,
  type DateRange,
} from '~/lib/date-range'

describe('addDays', () => {
  test('adds and subtracts days, including month/year rollover', () => {
    expect(toISODate(addDays(new Date(Date.UTC(2026, 0, 31)), 1))).toBe('2026-02-01')
    expect(toISODate(addDays(new Date(Date.UTC(2026, 0, 1)), -1))).toBe('2025-12-31')
  })
})

describe('addMonths', () => {
  test('adds and subtracts months, including year rollover', () => {
    expect(toISODate(addMonths(new Date(Date.UTC(2026, 11, 15)), 1))).toBe('2027-01-15')
    expect(toISODate(addMonths(new Date(Date.UTC(2026, 0, 15)), -1))).toBe('2025-12-15')
  })
})

describe('startOfMonth / startOfYear', () => {
  test('truncate to the 1st of the month / year', () => {
    expect(toISODate(startOfMonth(new Date(Date.UTC(2026, 5, 13))))).toBe('2026-06-01')
    expect(toISODate(startOfYear(new Date(Date.UTC(2026, 5, 13))))).toBe('2026-01-01')
  })
})

describe('startOfFinancialYear', () => {
  test('a date in Jan-Jun belongs to the FY starting the previous July', () => {
    expect(toISODate(startOfFinancialYear(new Date(Date.UTC(2026, 5, 13))))).toBe('2025-07-01')
    expect(toISODate(startOfFinancialYear(new Date(Date.UTC(2026, 5, 30))))).toBe('2025-07-01')
  })

  test('a date in Jul-Dec belongs to the FY starting that July', () => {
    expect(toISODate(startOfFinancialYear(new Date(Date.UTC(2026, 6, 1))))).toBe('2026-07-01')
    expect(toISODate(startOfFinancialYear(new Date(Date.UTC(2026, 11, 31))))).toBe('2026-07-01')
  })
})

describe('isSameDay', () => {
  test('compares calendar dates regardless of time of day', () => {
    expect(isSameDay(new Date(Date.UTC(2026, 5, 13, 0)), new Date(Date.UTC(2026, 5, 13, 23)))).toBe(true)
    expect(isSameDay(new Date(Date.UTC(2026, 5, 13)), new Date(Date.UTC(2026, 5, 14)))).toBe(false)
  })
})

describe('formatDate', () => {
  test('formats as "D MMM YYYY" using a fixed month table', () => {
    // Regression: `toLocaleDateString('en-AU', { month: 'short' })` is inconsistent across
    // runtimes (Bun vs Chromium) for June specifically, causing SSR/client hydration mismatches.
    expect(formatDate(new Date(Date.UTC(2026, 5, 13)))).toBe('13 Jun 2026')
    expect(formatDate(new Date(Date.UTC(2026, 6, 1)))).toBe('1 Jul 2026')
    expect(formatDate(new Date(Date.UTC(2025, 11, 31)))).toBe('31 Dec 2025')
    expect(formatDate(new Date(Date.UTC(2026, 0, 1)))).toBe('1 Jan 2026')
  })
})

describe('formatRange', () => {
  test('formats an explicit range as "start – end"', () => {
    const range: DateRange = { start: new Date(Date.UTC(2026, 4, 15)), end: new Date(Date.UTC(2026, 5, 13)) }
    expect(formatRange(range)).toBe('15 May 2026 – 13 Jun 2026')
  })

  test('formats "All time – end" when start is null', () => {
    const range: DateRange = { start: null, end: new Date(Date.UTC(2026, 5, 13)) }
    expect(formatRange(range)).toBe('All time – 13 Jun 2026')
  })
})

describe('serializeRange', () => {
  test('converts dates to ISO date strings, preserving a null start', () => {
    expect(serializeRange({ start: new Date(Date.UTC(2026, 4, 15)), end: new Date(Date.UTC(2026, 5, 13)) })).toEqual({
      start: '2026-05-15',
      end: '2026-06-13',
    })
    expect(serializeRange({ start: null, end: new Date(Date.UTC(2026, 5, 13)) })).toEqual({
      start: null,
      end: '2026-06-13',
    })
  })
})

describe('rangesEqual', () => {
  const a: DateRange = { start: new Date(Date.UTC(2026, 4, 15)), end: new Date(Date.UTC(2026, 5, 13)) }

  test('true for ranges with equal start/end', () => {
    const b: DateRange = { start: new Date(Date.UTC(2026, 4, 15)), end: new Date(Date.UTC(2026, 5, 13)) }
    expect(rangesEqual(a, b)).toBe(true)
  })

  test('treats null starts as equal to each other but not to a set start', () => {
    const nullStartA: DateRange = { start: null, end: new Date(Date.UTC(2026, 5, 13)) }
    const nullStartB: DateRange = { start: null, end: new Date(Date.UTC(2026, 5, 13)) }
    expect(rangesEqual(nullStartA, nullStartB)).toBe(true)
    expect(rangesEqual(nullStartA, a)).toBe(false)
  })

  test('false when start or end differ', () => {
    const differentStart: DateRange = { start: new Date(Date.UTC(2026, 4, 16)), end: new Date(Date.UTC(2026, 5, 13)) }
    expect(rangesEqual(a, differentStart)).toBe(false)
  })
})

describe('defaultBalanceHistoryRange', () => {
  test('is a trailing 30-day window ending today', () => {
    const range = defaultBalanceHistoryRange()
    expect(range.end.getTime()).toBe(todayUTC().getTime())
    expect(range.start).not.toBeNull()
    expect(toISODate(addDays(range.start!, 29))).toBe(toISODate(range.end))
  })
})

describe('RANGE_PRESETS', () => {
  test('every preset has a unique label', () => {
    const labels = RANGE_PRESETS.map((p) => p.label)
    expect(new Set(labels).size).toBe(labels.length)
  })

  test('"All time" has no start date', () => {
    const allTime = RANGE_PRESETS.find((p) => p.label === 'All time')!
    expect(allTime.range().start).toBeNull()
  })

  test('every other preset spans start <= end, both no later than today', () => {
    const today = todayUTC()
    for (const preset of RANGE_PRESETS) {
      if (preset.label === 'All time') continue
      const { start, end } = preset.range()
      expect(start).not.toBeNull()
      expect(start!.getTime()).toBeLessThanOrEqual(end.getTime())
      expect(end.getTime()).toBeLessThanOrEqual(today.getTime())
    }
  })

  test('"Last 7 days" spans exactly 6 days', () => {
    const { start, end } = RANGE_PRESETS.find((p) => p.label === 'Last 7 days')!.range()
    expect(toISODate(addDays(start!, 6))).toBe(toISODate(end))
  })

  test('"Last financial year" ends the day before "This financial year" starts, 12 months earlier', () => {
    const thisFy = RANGE_PRESETS.find((p) => p.label === 'This financial year')!.range()
    const lastFy = RANGE_PRESETS.find((p) => p.label === 'Last financial year')!.range()
    expect(toISODate(addDays(lastFy.end, 1))).toBe(toISODate(thisFy.start!))
    expect(toISODate(addMonths(lastFy.start!, 12))).toBe(toISODate(thisFy.start!))
  })
})
