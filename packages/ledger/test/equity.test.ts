import { describe, expect, test } from 'bun:test';
import { equityAt, netWorthAt, type AccountValuationInput } from '../src';

const manual = (id: string, classification: 'asset' | 'liability', values: [string, string][]): AccountValuationInput => ({
  id,
  name: id,
  classification,
  kind: 'currency',
  currency: 'AUD',
  movements: [],
  manualValues: values.map(([on, quantity]) => ({ on, quantity })),
});
const house = manual('house', 'asset', [['2026-01-01', '700000']]);
const loan = manual('loan', 'liability', [['2026-01-01', '-500000']]);
const offset = manual('offset', 'asset', [['2026-01-01', '50000']]);
const none = new Map();

describe('equity', () => {
  test('a $700k property with a $500k loan and a $50k offset has $250k equity, and net worth is unchanged', () => {
    const point = equityAt(house, [loan, offset], '2026-01-15', none, none);
    expect(point).toMatchObject({ equity: '250000', partial: false, stale: false });
    expect(point.loans.map((l) => l.id)).toEqual(['loan']);
    expect(point.offsets.map((o) => o.id)).toEqual(['offset']);
    expect(netWorthAt([house, loan, offset], '2026-01-15', none, none).netWorth).toBe('250000');
  });

  test('follows each input on its own dates', () => {
    const repaid = manual('loan', 'liability', [
      ['2026-01-01', '-500000'],
      ['2026-02-01', '-490000'],
    ]);
    expect(equityAt(house, [repaid], '2026-01-31', none, none).equity).toBe('200000');
    expect(equityAt(house, [repaid], '2026-02-01', none, none).equity).toBe('210000');
  });

  test('is unknown before the asset has a value, and partial when a loan cannot be valued', () => {
    expect(equityAt(house, [loan], '2025-12-31', none, none).equity).toBeNull();
    const usdLoan = { ...loan, currency: 'USD' };
    expect(equityAt(house, [usdLoan], '2026-01-15', none, none)).toMatchObject({ equity: '700000', partial: true });
  });

  test('a loan closed before the date no longer counts', () => {
    const closed = { ...loan, closedOn: '2026-01-10' };
    expect(equityAt(house, [closed], '2026-01-10', none, none).equity).toBe('200000');
    expect(equityAt(house, [closed], '2026-01-11', none, none)).toMatchObject({ equity: '700000', partial: false });
  });
});
