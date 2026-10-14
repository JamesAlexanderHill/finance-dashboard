import { describe, expect, test } from 'bun:test';
import { add, sub } from '@finance/shared';
import { buildSankey, type SankeyCategory } from '../src';

const categories: SankeyCategory[] = [
  { id: 'income', parentId: null, name: 'Income', kind: 'income' },
  { id: 'savings', parentId: null, name: 'Savings', kind: 'expense' },
  { id: 'essentials', parentId: null, name: 'Essentials', kind: 'expense' },
  { id: 'lifestyle', parentId: null, name: 'Lifestyle', kind: 'expense' },
  { id: 'salary', parentId: 'income', name: 'Salary', kind: 'income' },
  { id: 'groceries', parentId: 'essentials', name: 'Groceries', kind: 'expense' },
  { id: 'milk', parentId: 'groceries', name: 'Milk', kind: 'expense' },
  { id: 'fees', parentId: 'savings', name: 'Fees', kind: 'expense' },
];

const outOfHub = (r: ReturnType<typeof buildSankey>) => add('0', ...r.links.filter((l) => l.source === 'hub').map((l) => l.value));

describe('cash-flow Sankey', () => {
  test('unspent income is Unallocated and equals net cash flow', () => {
    const r = buildSankey(
      [
        { amount: '10000', categoryId: 'salary' },
        { amount: '-8990', categoryId: 'milk' },
        { amount: '-10', categoryId: 'fees' },
      ],
      categories,
    );
    expect(r.totals.netCashFlow).toBe('1000');
    expect(r.nodes.find((n) => n.id === 'unallocated')!.value).toBe('1000');
    expect(r.totals.spending).toBe('8990');
    expect(r.totals.saved).toBe('10');
    // Deep categories roll up to one child level by default.
    expect(r.links).toContainEqual({ source: 'essentials', target: 'groceries', value: '8990' });
    expect(outOfHub(r)).toBe('10000');
  });

  test('overspending shows Drawn from savings on the income side', () => {
    const r = buildSankey([{ amount: '100', categoryId: 'salary' }, { amount: '-150', categoryId: 'groceries' }], categories);
    expect(r.nodes.find((n) => n.id === 'drawn')!.value).toBe('50');
    expect(r.nodes.some((n) => n.id === 'unallocated')).toBe(false);
  });

  test('uncategorised legs appear as visible nodes and refunds reduce spending', () => {
    const r = buildSankey(
      [
        { amount: '500', categoryId: null },
        { amount: '-200', categoryId: null },
        { amount: '-100', categoryId: 'groceries' },
        { amount: '40', categoryId: 'groceries' },
      ],
      categories,
    );
    expect(r.totals.uncategorisedIncome).toBe('500');
    expect(r.totals.uncategorisedExpense).toBe('200');
    expect(r.totals.spending).toBe('60');
    expect(sub(r.totals.income, r.totals.outflow)).toBe(r.totals.netCashFlow);
  });

  test('drilling into a category shows its subtree', () => {
    const r = buildSankey([{ amount: '-5', categoryId: 'milk' }, { amount: '-7', categoryId: 'groceries' }], categories, 'essentials');
    expect(r.links).toContainEqual({ source: 'essentials', target: 'groceries', value: '12' });
    expect(r.links).toContainEqual({ source: 'groceries', target: 'milk', value: '5' });
    expect(r.links).toContainEqual({ source: 'groceries', target: 'groceries:other', value: '7' });
  });
});
