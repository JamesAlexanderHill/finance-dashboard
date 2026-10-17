import { describe, expect, test } from 'bun:test';
import { bucketsIn, cashFlowByPeriod, expensesByPeriod, periodSeries, type SankeyCategory } from '../src';

describe('periods', () => {
  test('month, quarter, year and Monday-start weeks with N previous periods', () => {
    expect(periodSeries('month', { date: '2026-03-15' }, 2).map((p) => [p.from, p.to, p.label])).toEqual([
      ['2026-01-01', '2026-01-31', 'Jan 2026'],
      ['2026-02-01', '2026-02-28', 'Feb 2026'],
      ['2026-03-01', '2026-03-31', 'Mar 2026'],
    ]);
    expect(periodSeries('quarter', { date: '2026-05-01' }, 1).map((p) => p.label)).toEqual(['Q1 2026', 'Q2 2026']);
    expect(periodSeries('year', { date: '2026-05-01' }, 0)[0]).toMatchObject({ from: '2026-01-01', to: '2026-12-31' });
    expect(periodSeries('week', { date: '2026-10-14' }, 0)[0]).toMatchObject({ from: '2026-10-12', to: '2026-10-18' });
  });

  test('a custom range compares with preceding ranges of the same length', () => {
    expect(periodSeries('custom', { from: '2026-10-11', to: '2026-10-20' }, 1).map((p) => [p.from, p.to])).toEqual([
      ['2026-10-01', '2026-10-10'],
      ['2026-10-11', '2026-10-20'],
    ]);
  });

  test('buckets split a range at a resolution, clipping the ends', () => {
    expect(bucketsIn({ from: '2026-10-08', to: '2026-10-20' }, 'week').buckets.map((p) => [p.from, p.to])).toEqual([
      ['2026-10-08', '2026-10-11'],
      ['2026-10-12', '2026-10-18'],
      ['2026-10-19', '2026-10-20'],
    ]);
    expect(bucketsIn({ from: '2026-01-01', to: '2026-12-31' }, 'quarter').buckets.map((p) => p.label)).toEqual([
      'Q1 2026',
      'Q2 2026',
      'Q3 2026',
      'Q4 2026',
    ]);
    expect(bucketsIn({ from: '2026-10-01', to: '2026-10-03' }, 'day').buckets.map((p) => p.label)).toEqual(['1 Oct', '2 Oct', '3 Oct']);
    const long = bucketsIn({ from: '2020-01-01', to: '2026-12-31' }, 'day');
    expect([long.resolution, long.buckets.length]).toEqual(['week', 366]);
  });
});

const categories: SankeyCategory[] = [
  { id: 'income', parentId: null, name: 'Income', kind: 'income' },
  { id: 'essentials', parentId: null, name: 'Essentials', kind: 'expense' },
  { id: 'lifestyle', parentId: null, name: 'Lifestyle', kind: 'expense' },
  { id: 'groceries', parentId: 'essentials', name: 'Groceries', kind: 'expense' },
  { id: 'milk', parentId: 'groceries', name: 'Milk', kind: 'expense' },
];
const periods = periodSeries('month', { date: '2026-02-10' }, 1);
const legs = [
  { occurredOn: '2026-01-05', amount: '1000', categoryId: 'income' },
  { occurredOn: '2026-01-06', amount: '-300', categoryId: 'milk' },
  { occurredOn: '2026-01-07', amount: '-50', categoryId: null },
  { occurredOn: '2026-02-03', amount: '-80', categoryId: 'lifestyle' },
  { occurredOn: '2026-02-04', amount: '20', categoryId: 'lifestyle' },
];

describe('cash flow by period', () => {
  test('income, outflow and net per period, with refunds reducing spending', () => {
    expect(cashFlowByPeriod(legs, categories, periods).map((p) => [p.label, p.income, p.outflow, p.net])).toEqual([
      ['Jan 2026', '1000', '350', '650'],
      ['Feb 2026', '0', '60', '-60'],
    ]);
  });

  test('expenses stack by top-level category and drill into a subtree', () => {
    expect(expensesByPeriod(legs, categories, periods, null).map((p) => p.segments)).toEqual([
      { essentials: '300', uncategorised: '50' },
      { lifestyle: '60' },
    ]);
    expect(expensesByPeriod(legs, categories, periods, 'essentials')[0]!.segments).toEqual({ groceries: '300' });
  });
});
