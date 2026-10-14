import { describe, expect, test } from 'bun:test';
import { isStale, previousBusinessDay, priceAt } from '../src';

describe('business days and staleness', () => {
  test('the previous business day skips weekends', () => {
    expect(previousBusinessDay('2026-10-14')).toBe('2026-10-13'); // Wed → Tue
    expect(previousBusinessDay('2026-10-12')).toBe('2026-10-09'); // Mon → Fri
    expect(previousBusinessDay('2026-10-11')).toBe('2026-10-09'); // Sun → Fri
  });

  test('a price is stale once older than the previous business day', () => {
    expect(isStale('2026-10-09', '2026-10-12')).toBe(false); // Friday close, valued Monday
    expect(isStale('2026-10-08', '2026-10-12')).toBe(true);
  });
});

describe('priceAt', () => {
  const obs = [
    { on: '2026-10-05', price: '10', currency: 'AUD', priceType: 'daily' as const },
    { on: '2026-10-08', price: '11', currency: 'AUD', priceType: 'trade' as const },
    { on: '2026-10-09', price: '12', currency: 'AUD', priceType: 'daily' as const },
    { on: '2026-10-09', price: '12.5', currency: 'AUD', priceType: 'manual' as const },
  ];

  test('uses a fresh daily or manual price, preferring manual on the same day', () => {
    expect(priceAt(obs, '2026-10-12')).toMatchObject({ on: '2026-10-09', price: '12.5', stale: false, tradePriced: false });
  });

  test('falls back to a fresh trade price only when no fresh daily price exists', () => {
    expect(priceAt(obs, '2026-10-09')).toMatchObject({ price: '12.5' });
    expect(priceAt(obs.slice(0, 2), '2026-10-09')).toMatchObject({ on: '2026-10-08', price: '11', tradePriced: true, stale: false });
  });

  test('otherwise uses the latest observation and marks it stale; never a future one', () => {
    expect(priceAt(obs.slice(0, 1), '2026-10-12')).toMatchObject({ price: '10', stale: true });
    expect(priceAt(obs, '2026-10-04')).toBeNull();
  });
});
