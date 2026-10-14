import { describe, expect, test } from 'bun:test';
import { planTransferMatches, type TransferCandidate } from '../src';

const t = (id: string, accountId: string, amount: string, postedOn = '2026-01-10', commodity = 'AUD'): TransferCandidate => ({
  id,
  accountId,
  amount,
  postedOn,
  commodity,
});

describe('transfer auto-matching', () => {
  test('matches opposite, exactly equal amounts in the same commodity across accounts', () => {
    const { pairs, ambiguous } = planTransferMatches([t('out', 'cba', '-500.00'), t('in', 'wise', '500')]);
    expect(pairs.map(([a, b]) => [a.id, b.id])).toEqual([['out', 'in']]);
    expect(ambiguous.size).toBe(0);
  });

  test('respects the ±5 calendar day window', () => {
    expect(planTransferMatches([t('out', 'cba', '-500', '2026-01-10'), t('in', 'wise', '500', '2026-01-15')]).pairs).toHaveLength(1);
    expect(planTransferMatches([t('out', 'cba', '-500', '2026-01-10'), t('in', 'wise', '500', '2026-01-16')]).pairs).toHaveLength(0);
  });

  test('never matches within one account, across commodities or for unequal amounts', () => {
    expect(planTransferMatches([t('a', 'cba', '-500'), t('b', 'cba', '500')]).pairs).toHaveLength(0);
    expect(planTransferMatches([t('a', 'cba', '-500'), t('b', 'wise', '500', '2026-01-10', 'NZD')]).pairs).toHaveLength(0);
    expect(planTransferMatches([t('a', 'cba', '-500'), t('b', 'wise', '500.01')]).pairs).toHaveLength(0);
  });

  test('more than one candidate on either side goes to review instead', () => {
    const { pairs, ambiguous } = planTransferMatches([
      t('out', 'cba', '-500'),
      t('in1', 'wise', '500'),
      t('in2', 'amex', '500', '2026-01-12'),
    ]);
    expect(pairs).toHaveLength(0);
    expect(
      ambiguous
        .get('out')!
        .map((c) => c.id)
        .sort(),
    ).toEqual(['in1', 'in2']);
    expect(ambiguous.has('in1')).toBe(true);
  });

  test('a stated counterpart date narrows weekly transfers to one candidate each', () => {
    // Paid every Saturday, credited the following Tuesday: by date alone each deposit has two candidates.
    const txns = [
      t('sat1', 'cba', '-200', '2024-01-06'),
      t('tue1', 'vanguard', '200', '2024-01-09'),
      t('sat2', 'cba', '-200', '2024-01-13'),
      t('tue2', 'vanguard', '200', '2024-01-16'),
    ];
    expect(planTransferMatches(txns).pairs).toHaveLength(0);
    const withRefs = txns.map((x) =>
      x.id === 'tue1' ? { ...x, counterpartDate: '2024-01-06' } : x.id === 'tue2' ? { ...x, counterpartDate: '2024-01-13' } : x,
    );
    expect(planTransferMatches(withRefs).pairs.map(([a, b]) => [a.id, b.id])).toEqual([
      ['sat1', 'tue1'],
      ['sat2', 'tue2'],
    ]);
  });
});
