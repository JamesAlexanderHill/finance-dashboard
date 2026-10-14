import { describe, expect, test } from 'bun:test';
import { effectivePrices, snapshotMismatches, unitsAt, unitsSeries, valueSeries } from '../src';

describe('units series', () => {
  const series = unitsSeries({ on: '2024-07-01', quantity: '10' }, [
    { on: '2024-08-01', quantity: '5' },
    { on: '2024-08-01', quantity: '2' },
    { on: '2024-09-01', quantity: '-3' },
  ]);

  test('steps from the opening position through each movement date', () => {
    expect(series).toEqual([
      { on: '2024-07-01', quantity: '10' },
      { on: '2024-08-01', quantity: '17' },
      { on: '2024-09-01', quantity: '14' },
    ]);
    expect(unitsAt(series, '2024-06-30')).toBe('0');
    expect(unitsAt(series, '2024-08-15')).toBe('17');
  });

  test('buying five units increases the position by five', () => {
    const s = unitsSeries({ on: '2025-01-01', quantity: '0' }, [{ on: '2025-01-02', quantity: '5' }]);
    expect(unitsAt(s, '2025-01-02')).toBe('5');
  });

  test('snapshots are checkpoints: only disagreements are reported', () => {
    expect(snapshotMismatches(series, [{ on: '2024-08-31', quantity: '17.00' }])).toEqual([]);
    expect(snapshotMismatches(series, [{ on: '2024-09-30', quantity: '15' }])).toEqual([
      { on: '2024-09-30', reported: '15', computed: '14' },
    ]);
  });
});

describe('prices and value', () => {
  test('manual beats daily, daily beats trade, and trade is only a fallback', () => {
    const prices = effectivePrices([
      { on: '2025-01-02', price: '100', currency: 'AUD', priceType: 'daily' },
      { on: '2025-01-02', price: '99', currency: 'AUD', priceType: 'trade' },
      { on: '2025-01-03', price: '101', currency: 'AUD', priceType: 'trade' },
      { on: '2025-01-06', price: '102', currency: 'AUD', priceType: 'daily' },
      { on: '2025-01-06', price: '105', currency: 'AUD', priceType: 'manual' },
    ]);
    expect(prices.map((p) => [p.on, p.price, p.priceType])).toEqual([
      ['2025-01-02', '100', 'daily'],
      ['2025-01-03', '101', 'trade'],
      ['2025-01-06', '105', 'manual'],
    ]);
  });

  test('10 → 12 units at an unchanged $100 changes value $1,000 → $1,200 with no price change', () => {
    const units = unitsSeries({ on: '2025-01-01', quantity: '10' }, [{ on: '2025-01-03', quantity: '2' }]);
    const prices = effectivePrices([
      { on: '2025-01-02', price: '100', currency: 'AUD', priceType: 'daily' },
      { on: '2025-01-03', price: '100', currency: 'AUD', priceType: 'daily' },
    ]);
    expect(valueSeries(units, prices).map((p) => [p.on, p.price, p.units, p.value])).toEqual([
      ['2025-01-02', '100', '10', '1000'],
      ['2025-01-03', '100', '12', '1200'],
    ]);
  });

  test('value exists only on dates with a price; gaps are not filled', () => {
    const units = unitsSeries({ on: '2025-01-01', quantity: '1' }, []);
    expect(valueSeries(units, effectivePrices([{ on: '2025-01-10', price: '5', currency: 'AUD', priceType: 'daily' }]))).toHaveLength(1);
  });
});
