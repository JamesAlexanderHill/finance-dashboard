import { describe, expect, test } from 'bun:test'
import { parseCanonicalCsv } from '../canonical'

const HEADER = 'externalEventId,eventGroup,eventDescription,effectiveAt,postedAt,legDescription,legTicker,legUnitCount'

describe('parseCanonicalCsv', () => {
  test('parses a single-leg event', () => {
    const csv = `${HEADER}\n12345,12345,Coffee Shop,2025-02-01T00:00:00Z,2025-02-02T00:00:00Z,Coffee Shop,AUD,-1250\n`
    const { events, errors } = parseCanonicalCsv(csv)

    expect(errors).toEqual([])
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      eventGroup: '12345',
      externalEventId: '12345',
      description: 'Coffee Shop',
      legs: [{ instrumentCode: 'AUD', amountMinor: -1250n }],
    })
    expect(events[0].effectiveAt).toEqual(new Date('2025-02-01T00:00:00Z'))
    expect(events[0].postedAt).toEqual(new Date('2025-02-02T00:00:00Z'))
  })

  test('groups multiple rows sharing an eventGroup into one event with multiple legs', () => {
    const csv = [
      HEADER,
      'abc,abc,Currency exchange AUD -> NZD,2025-06-19T21:28:31Z,2025-06-19T21:30:00Z,Sold AUD,AUD,-5000',
      'abc,abc,Currency exchange AUD -> NZD,2025-06-19T21:28:31Z,2025-06-19T21:30:00Z,Bought NZD,NZD,5400',
    ].join('\n')

    const { events, errors } = parseCanonicalCsv(csv)

    expect(errors).toEqual([])
    expect(events).toHaveLength(1)
    expect(events[0].legs).toEqual([
      { instrumentCode: 'AUD', amountMinor: -5000n },
      { instrumentCode: 'NZD', amountMinor: 5400n },
    ])
  })

  test('returns an error when a required column is missing', () => {
    const { events, errors } = parseCanonicalCsv('externalEventId,eventGroup,eventDescription\n')

    expect(events).toEqual([])
    expect(errors.length).toBeGreaterThan(0)
    expect(errors[0].message).toContain('Missing required column')
  })

  test('returns an error for an empty file', () => {
    const { events, errors } = parseCanonicalCsv('')

    expect(events).toEqual([])
    expect(errors).toEqual([{ line: 0, message: 'File is empty' }])
  })

  test('skips a row with a missing eventGroup and reports an error', () => {
    const csv = `${HEADER}\n12345,,Coffee Shop,2025-02-01T00:00:00Z,2025-02-01T00:00:00Z,Coffee Shop,AUD,-1250\n`
    const { events, errors } = parseCanonicalCsv(csv)

    expect(events).toEqual([])
    expect(errors).toEqual([{ line: 2, message: 'eventGroup is required' }])
  })

  test('rejects a group whose rows disagree on event-level fields', () => {
    const csv = [
      HEADER,
      'abc,abc,Description A,2025-02-01T00:00:00Z,2025-02-01T00:00:00Z,Leg 1,AUD,-1000',
      'abc,abc,Description B,2025-02-01T00:00:00Z,2025-02-01T00:00:00Z,Leg 2,VAS,10',
    ].join('\n')

    const { events, errors } = parseCanonicalCsv(csv)

    expect(events).toEqual([])
    expect(errors).toHaveLength(1)
    expect(errors[0].message).toContain('conflicting value for "eventDescription"')
  })

  test('returns an error for an invalid effectiveAt date', () => {
    const csv = `${HEADER}\n12345,12345,Coffee Shop,not-a-date,2025-02-01T00:00:00Z,Coffee Shop,AUD,-1250\n`
    const { events, errors } = parseCanonicalCsv(csv)

    expect(events).toEqual([])
    expect(errors[0].message).toContain('Invalid effectiveAt date')
  })

  test('returns an error for a missing legTicker', () => {
    const csv = `${HEADER}\n12345,12345,Coffee Shop,2025-02-01T00:00:00Z,2025-02-01T00:00:00Z,Coffee Shop,,-1250\n`
    const { events, errors } = parseCanonicalCsv(csv)

    expect(events).toEqual([])
    expect(errors[0].message).toBe('legTicker is required')
  })

  test('returns an error for a non-numeric legUnitCount', () => {
    const csv = `${HEADER}\n12345,12345,Coffee Shop,2025-02-01T00:00:00Z,2025-02-01T00:00:00Z,Coffee Shop,AUD,abc\n`
    const { events, errors } = parseCanonicalCsv(csv)

    expect(events).toEqual([])
    expect(errors[0].message).toContain('Invalid legUnitCount')
  })

  test('handles quoted fields containing commas', () => {
    const csv = `${HEADER}\n12345,12345,"Coffee, with milk",2025-02-01T00:00:00Z,2025-02-01T00:00:00Z,"Coffee, with milk",AUD,-1250\n`
    const { events, errors } = parseCanonicalCsv(csv)

    expect(errors).toEqual([])
    expect(events[0].description).toBe('Coffee, with milk')
  })
})
