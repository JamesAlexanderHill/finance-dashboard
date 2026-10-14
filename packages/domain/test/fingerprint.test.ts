import { describe, expect, test } from 'bun:test';
import { normaliseDescription, withOrdinals } from '../src';

const row = (description: string, amount = '-10.00') => ({ accountId: 'a', postedOn: '2026-01-01', amount, description });

describe('fingerprints', () => {
  test('normalises description punctuation, case and spacing', () => {
    expect(normaliseDescription('  Beem  it*  Pty.Ltd ')).toBe('BEEM IT PTY LTD');
  });

  test('identical rows in one file get increasing ordinals and distinct fingerprints', () => {
    const rows = withOrdinals([row('Coffee'), row('Coffee'), row('Tea')]);
    expect(rows.map((r) => r.ordinal)).toEqual([0, 1, 0]);
    expect(new Set(rows.map((r) => r.fingerprint)).size).toBe(3);
  });

  test('amount formatting does not change the fingerprint', () => {
    const [a] = withOrdinals([row('Coffee', '-10.00')]);
    const [b] = withOrdinals([row('coffee', '-10')]);
    expect(a!.fingerprint).toBe(b!.fingerprint);
  });

  test('rows with a provider ID match by it, regardless of description or ordinal', () => {
    const [a] = withOrdinals([{ ...row('Coffee'), providerId: 'CARD-1' }]);
    const [, b] = withOrdinals([
      { ...row('Tea'), providerId: 'CARD-0' },
      { ...row('Coffee (edited)'), providerId: 'CARD-1' },
    ]);
    expect(a!.fingerprint).toBe(b!.fingerprint);
  });
});
