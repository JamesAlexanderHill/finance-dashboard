import { describe, expect, test, afterEach } from 'bun:test'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { CANONICAL_HEADER, formatCanonicalRow, writeCanonicalCsv, type CanonicalLeg } from '../canonical'

const leg: CanonicalLeg = {
  externalEventId: '123',
  eventGroup: '123',
  eventDescription: 'Coffee, "good" stuff',
  effectiveAt: '2025-02-01T00:00:00Z',
  postedAt: '2025-02-02T00:00:00Z',
  legDescription: 'Coffee, "good" stuff',
  legTicker: 'AUD',
  legUnitCount: -1250,
}

describe('formatCanonicalRow', () => {
  test('joins fields with commas, escaping as needed', () => {
    expect(formatCanonicalRow(leg)).toBe(
      '123,123,"Coffee, ""good"" stuff",2025-02-01T00:00:00Z,2025-02-02T00:00:00Z,"Coffee, ""good"" stuff",AUD,-1250',
    )
  })
})

describe('writeCanonicalCsv', () => {
  const outPath = join('/tmp', `canonical-test-${process.pid}.csv`)

  afterEach(() => {
    if (existsSync(outPath)) rmSync(outPath)
  })

  test('writes a header row followed by one row per leg', () => {
    writeCanonicalCsv(outPath, [leg])
    const content = readFileSync(outPath, 'utf8')
    const lines = content.trimEnd().split('\n')
    expect(lines[0]).toBe(CANONICAL_HEADER.join(','))
    expect(lines[1]).toBe(formatCanonicalRow(leg))
    expect(lines).toHaveLength(2)
  })
})
