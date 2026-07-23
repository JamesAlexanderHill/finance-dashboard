import { describe, expect, test } from 'bun:test'
import { computeDedupeKey } from '~/features/imports/infrastructure/dedupe'

describe('computeDedupeKey', () => {
  test('uses accountId:externalEventId when an external ID is provided', async () => {
    const key = await computeDedupeKey({
      accountId: 'acct-1',
      externalEventId: 'ext-123',
      effectiveAt: new Date('2025-01-01T00:00:00Z'),
      primaryAmountMinor: 100n,
      description: 'Whatever',
    })

    expect(key).toBe('acct-1:ext-123')
  })

  test('hashes stable fields when there is no external ID', async () => {
    const key = await computeDedupeKey({
      accountId: 'acct-1',
      externalEventId: null,
      effectiveAt: new Date('2025-01-01T00:00:00Z'),
      primaryAmountMinor: -500n,
      description: 'Coffee',
    })

    // SHA-256 hex digest
    expect(key).toMatch(/^[0-9a-f]{64}$/)
  })

  test('hash is deterministic for the same inputs', async () => {
    const params = {
      accountId: 'acct-1',
      externalEventId: null,
      effectiveAt: new Date('2025-01-01T00:00:00Z'),
      primaryAmountMinor: -500n,
      description: 'Coffee',
    }

    expect(await computeDedupeKey(params)).toBe(await computeDedupeKey({ ...params }))
  })

  test('description normalization (case/whitespace) does not change the hash', async () => {
    const base = {
      accountId: 'acct-1',
      externalEventId: null,
      effectiveAt: new Date('2025-01-01T00:00:00Z'),
      primaryAmountMinor: -500n,
    }

    const a = await computeDedupeKey({ ...base, description: 'Coffee Shop' })
    const b = await computeDedupeKey({ ...base, description: '  coffee   shop  ' })

    expect(a).toBe(b)
  })

  test('different amounts produce different hashes', async () => {
    const base = {
      accountId: 'acct-1',
      externalEventId: null,
      effectiveAt: new Date('2025-01-01T00:00:00Z'),
      description: 'Coffee',
    }

    const a = await computeDedupeKey({ ...base, primaryAmountMinor: -500n })
    const b = await computeDedupeKey({ ...base, primaryAmountMinor: -501n })

    expect(a).not.toBe(b)
  })

  test('empty externalEventId string falls back to the hash path', async () => {
    const key = await computeDedupeKey({
      accountId: 'acct-1',
      externalEventId: '',
      effectiveAt: new Date('2025-01-01T00:00:00Z'),
      primaryAmountMinor: -500n,
      description: 'Coffee',
    })

    expect(key).toMatch(/^[0-9a-f]{64}$/)
  })
})
