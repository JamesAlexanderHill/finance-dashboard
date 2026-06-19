import { describe, expect, test } from 'bun:test'
import { expandAnnotations, type AnnotationForExpansion } from '~/lib/timeline-annotations'

function makeAnnotation(overrides: Partial<AnnotationForExpansion> = {}): AnnotationForExpansion {
  return {
    id: 'ann-1',
    accountId: 'acct-1',
    label: 'Test',
    date: new Date('2026-01-15T00:00:00Z'),
    recurrence: null,
    ...overrides,
  }
}

function toISODate(d: Date) {
  return d.toISOString().slice(0, 10)
}

const JAN_1 = new Date('2026-01-01T00:00:00Z')
const JAN_31 = new Date('2026-01-31T00:00:00Z')
const DEC_31 = new Date('2026-12-31T00:00:00Z')

describe('expandAnnotations', () => {
  test('empty input returns []', () => {
    expect(expandAnnotations([], JAN_1, JAN_31)).toEqual([])
  })

  test('one-time annotation inside range → 1 occurrence', () => {
    const ann = makeAnnotation({ date: new Date('2026-01-15T00:00:00Z') })
    const result = expandAnnotations([ann], JAN_1, JAN_31)
    expect(result).toHaveLength(1)
    expect(toISODate(result[0].occurrenceDate)).toBe('2026-01-15')
    expect(result[0].annotation).toBe(ann)
  })

  test('one-time annotation outside range → 0 occurrences', () => {
    const ann = makeAnnotation({ date: new Date('2025-01-01T00:00:00Z') })
    expect(expandAnnotations([ann], JAN_1, JAN_31)).toHaveLength(0)
  })

  test('one-time annotation on rangeStart boundary → included', () => {
    const ann = makeAnnotation({ date: JAN_1 })
    const result = expandAnnotations([ann], JAN_1, JAN_31)
    expect(result).toHaveLength(1)
    expect(toISODate(result[0].occurrenceDate)).toBe('2026-01-01')
  })

  test('one-time annotation on rangeEnd boundary → included', () => {
    const ann = makeAnnotation({ date: JAN_31 })
    const result = expandAnnotations([ann], JAN_1, JAN_31)
    expect(result).toHaveLength(1)
    expect(toISODate(result[0].occurrenceDate)).toBe('2026-01-31')
  })

  test('weekly: anchor within range, correct occurrence count', () => {
    // anchor = Jan 1, range = Jan 1–21 → Jan 1, 8, 15 (Jan 22 > rangeEnd)
    const ann = makeAnnotation({ date: JAN_1, recurrence: { frequency: 'weekly' } })
    const result = expandAnnotations([ann], JAN_1, new Date('2026-01-21T00:00:00Z'))
    expect(result).toHaveLength(3)
    expect(toISODate(result[0].occurrenceDate)).toBe('2026-01-01')
    expect(toISODate(result[1].occurrenceDate)).toBe('2026-01-08')
    expect(toISODate(result[2].occurrenceDate)).toBe('2026-01-15')
  })

  test('weekly: anchor after rangeStart → walk-back finds earlier occurrences', () => {
    // anchor = Jan 10, range = Jan 1–31
    // walk back: Jan 3 (10-7), Jan 3 >= Jan 1 ✓; Jan -4 < Jan 1, stop
    // walk forward: Jan 10, 17, 24, 31
    const ann = makeAnnotation({ date: new Date('2026-01-10T00:00:00Z'), recurrence: { frequency: 'weekly' } })
    const result = expandAnnotations([ann], JAN_1, JAN_31)
    const dates = result.map((r) => toISODate(r.occurrenceDate))
    expect(dates).toContain('2026-01-03')
    expect(dates).toContain('2026-01-10')
    expect(dates).toContain('2026-01-17')
    expect(dates).toContain('2026-01-24')
    expect(dates).toContain('2026-01-31')
  })

  test('weekly: anchor before rangeStart → walk-forward only lands in range', () => {
    // anchor = Dec 1 2025, step 7 days. Range = Jan 1–31 2026.
    // Dec 1 + 4*7 = Dec 29 (outside range), Dec 1 + 5*7 = Jan 5 ✓
    const anchor = new Date('2025-12-01T00:00:00Z')
    const ann = makeAnnotation({ date: anchor, recurrence: { frequency: 'weekly' } })
    const result = expandAnnotations([ann], JAN_1, JAN_31)
    const dates = result.map((r) => toISODate(r.occurrenceDate))
    expect(dates).toContain('2026-01-05')
    expect(dates).toContain('2026-01-12')
    expect(dates).not.toContain('2025-12-29')
  })

  test('monthly: same day each month, multiple occurrences', () => {
    // anchor = Jan 15, range = Jan 1 – Apr 30
    const ann = makeAnnotation({ date: new Date('2026-01-15T00:00:00Z'), recurrence: { frequency: 'monthly' } })
    const result = expandAnnotations([ann], JAN_1, new Date('2026-04-30T00:00:00Z'))
    const dates = result.map((r) => toISODate(r.occurrenceDate))
    expect(dates).toEqual(['2026-01-15', '2026-02-15', '2026-03-15', '2026-04-15'])
  })

  test('monthly: anchor on day 31, clamps to last day of shorter months', () => {
    // Jan 31 + 1 month → Feb 28 (2026 is not a leap year), +2 months → Mar 31, +3 → Apr 30
    const ann = makeAnnotation({ date: new Date('2026-01-31T00:00:00Z'), recurrence: { frequency: 'monthly' } })
    const result = expandAnnotations([ann], JAN_1, new Date('2026-04-30T00:00:00Z'))
    const dates = result.map((r) => toISODate(r.occurrenceDate))
    expect(dates[0]).toBe('2026-01-31')
    expect(dates[1]).toBe('2026-02-28')
    expect(dates[2]).toBe('2026-03-31')
    expect(dates[3]).toBe('2026-04-30')
  })

  test('yearly: anchor within a 2-year range → 2 occurrences', () => {
    // anchor = Nov 1 2025, range = Jan 1 2025 – Dec 31 2026
    const ann = makeAnnotation({
      date: new Date('2025-11-01T00:00:00Z'),
      recurrence: { frequency: 'yearly' },
    })
    const result = expandAnnotations([ann], new Date('2025-01-01T00:00:00Z'), DEC_31)
    const dates = result.map((r) => toISODate(r.occurrenceDate))
    expect(dates).toEqual(['2025-11-01', '2026-11-01'])
  })

  test('multiple annotations → result sorted ascending by occurrenceDate', () => {
    const ann1 = makeAnnotation({ id: 'ann-1', date: new Date('2026-01-20T00:00:00Z') })
    const ann2 = makeAnnotation({ id: 'ann-2', date: new Date('2026-01-10T00:00:00Z') })
    const result = expandAnnotations([ann1, ann2], JAN_1, JAN_31)
    expect(result).toHaveLength(2)
    expect(toISODate(result[0].occurrenceDate)).toBe('2026-01-10')
    expect(toISODate(result[1].occurrenceDate)).toBe('2026-01-20')
  })

  test('rangeStart === rangeEnd and anchor matches → 1 occurrence', () => {
    const ann = makeAnnotation({ date: JAN_15 })
    const result = expandAnnotations([ann], JAN_15, JAN_15)
    expect(result).toHaveLength(1)
  })

  test('rangeStart > rangeEnd → [] (impossible range)', () => {
    const ann = makeAnnotation({ date: JAN_1 })
    expect(expandAnnotations([ann], JAN_31, JAN_1)).toHaveLength(0)
  })
})

const JAN_15 = new Date('2026-01-15T00:00:00Z')
