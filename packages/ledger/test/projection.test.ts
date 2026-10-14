import { describe, expect, test } from 'bun:test';
import { ItemisationError, projectEvents, validateItemisation, type DecisionRecord } from '../src';

const tx = (id: string, amount: string) => ({ id, accountId: 'acc', postedOn: '2026-01-05', description: `Tx ${id}`, amount, commodity: 'AUD' });
const categories = [
  { id: 'groceries', kind: 'expense' as const },
  { id: 'salary', kind: 'income' as const },
];
let seq = 0;
const decision = (transactionId: string, kind: DecisionRecord['kind'], payload: unknown, legKey = ''): DecisionRecord => ({
  id: `d${++seq}`,
  seq,
  transactionId,
  kind,
  legKey,
  payload,
});

describe('event projection', () => {
  test('is deterministic and starts every leg uncategorised', () => {
    const input = { transactions: [tx('a', '-30'), tx('b', '1000')], decisions: [], categories, openingBalances: [] };
    const first = projectEvents(input);
    expect(projectEvents(input)).toEqual(first);
    expect(first.map((e) => e.type).sort()).toEqual(['expense', 'income']);
    expect(first.flatMap((e) => e.legs).every((l) => l.categoryId === null)).toBe(true);
  });

  test('the latest category decision wins and a refund keeps its expense category', () => {
    const decisions = [
      decision('a', 'category', { categoryId: 'salary' }, 'principal'),
      decision('a', 'category', { categoryId: 'groceries' }, 'principal'),
      decision('r', 'category', { categoryId: 'groceries' }, 'principal'),
    ];
    const events = projectEvents({ transactions: [tx('a', '-30'), tx('r', '5')], decisions, categories, openingBalances: [] });
    expect(events.find((e) => e.transactionIds[0] === 'a')!.legs[0]!.categoryId).toBe('groceries');
    expect(events.find((e) => e.transactionIds[0] === 'r')!.type).toBe('refund');
  });

  test('itemisation produces one leg per line with stable keys', () => {
    const decisions = [decision('a', 'itemisation', { lines: [{ amount: '-10', description: 'Milk' }, { amount: '-20', description: 'Bread' }] })];
    const [event] = projectEvents({ transactions: [tx('a', '-30')], decisions, categories, openingBalances: [] });
    expect(event!.legs.map((l) => [l.legKey, l.amount])).toEqual([
      ['line:0', '-10'],
      ['line:1', '-20'],
    ]);
  });

  test('categories pointing at a removed category fall back to Uncategorised', () => {
    const decisions = [decision('a', 'category', { categoryId: 'gone' }, 'principal')];
    const [event] = projectEvents({ transactions: [tx('a', '-30')], decisions, categories, openingBalances: [] });
    expect(event!.legs[0]!.categoryId).toBeNull();
  });
});

describe('itemisation validation', () => {
  test('line items must sum exactly', () => {
    expect(() => validateItemisation('-30', [{ amount: '-10', description: '' }, { amount: '-19.99', description: '' }])).toThrow(ItemisationError);
    expect(() => validateItemisation('-30', [{ amount: '-10', description: '' }, { amount: '-20', description: '' }])).not.toThrow();
  });
});
