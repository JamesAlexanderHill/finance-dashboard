import { describe, expect, test } from 'bun:test';
import { presetRange, previousRange, rangeLabel, shiftRange } from '../src';

describe('date ranges', () => {
  test('presets are relative to today', () => {
    const today = '2026-10-17';
    expect(presetRange('this-month', today)).toEqual({ from: '2026-10-01', to: '2026-10-31' });
    expect(presetRange('last-month', today)).toEqual({ from: '2026-09-01', to: '2026-09-30' });
    expect(presetRange('this-quarter', today)).toEqual({ from: '2026-10-01', to: '2026-12-31' });
    expect(presetRange('last-quarter', today)).toEqual({ from: '2026-07-01', to: '2026-09-30' });
    expect(presetRange('ytd', today)).toEqual({ from: '2026-01-01', to: today });
    expect(presetRange('last-year', today)).toEqual({ from: '2025-01-01', to: '2025-12-31' });
    expect(presetRange('last-30', today)).toEqual({ from: '2026-09-18', to: today });
    expect(presetRange('last-12m', today)).toEqual({ from: '2025-10-18', to: today });
  });

  test('the compare period is the previous calendar period, the same span last year, or the same length before', () => {
    expect(previousRange({ from: '2026-03-01', to: '2026-03-31' })).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(previousRange({ from: '2026-01-01', to: '2026-03-31' })).toEqual({ from: '2025-10-01', to: '2025-12-31' });
    expect(previousRange({ from: '2026-01-01', to: '2026-10-17' })).toEqual({ from: '2025-01-01', to: '2025-10-17' });
    expect(previousRange({ from: '2026-10-11', to: '2026-10-20' })).toEqual({ from: '2026-10-01', to: '2026-10-10' });
    expect(shiftRange({ from: '2026-02-01', to: '2026-02-28' }, 1)).toEqual({ from: '2026-03-01', to: '2026-03-31' });
  });

  test('labels name calendar periods', () => {
    expect(rangeLabel({ from: '2026-10-01', to: '2026-10-31' })).toBe('Oct 2026');
    expect(rangeLabel({ from: '2026-07-01', to: '2026-09-30' })).toBe('Q3 2026');
    expect(rangeLabel({ from: '2026-01-01', to: '2026-12-31' })).toBe('2026');
    expect(rangeLabel({ from: '2026-01-01', to: '2026-10-17' })).toBe('1 Jan – 17 Oct 2026');
    expect(rangeLabel({ from: '2025-10-18', to: '2026-10-17' })).toBe('18 Oct 2025 – 17 Oct 2026');
  });
});
