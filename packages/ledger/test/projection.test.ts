import { describe, expect, test } from 'bun:test';
import { ItemisationError, projectEvents, validateItemisation, type ActiveTransaction, type DecisionRecord } from '../src';

const tx = (id: string, amount: string, extra: Partial<ActiveTransaction> = {}): ActiveTransaction => ({
  id,
  accountId: 'acc',
  postedOn: '2026-01-05',
  description: `Tx ${id}`,
  amount,
  commodity: 'AUD',
  role: 'principal',
  providerGroupRef: null,
  isTransferHint: false,
  ...extra,
});
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

describe('grouping and transfers', () => {
  const project = (transactions: ActiveTransaction[], decisions: DecisionRecord[] = []) =>
    projectEvents({ transactions, decisions, categories, openingBalances: [] });

  test('a Wise conversion and its fee across currency accounts form one conversion event', () => {
    const [event, ...rest] = project([
      tx('aud', '-30.10', { accountId: 'wise-aud', providerGroupRef: 'wise:BALANCE-1' }),
      tx('fee', '-0.10', { accountId: 'wise-aud', providerGroupRef: 'wise:BALANCE-1', role: 'fee' }),
      tx('nzd', '33.00', { accountId: 'wise-nzd', commodity: 'NZD', providerGroupRef: 'wise:BALANCE-1' }),
    ]);
    expect(rest).toHaveLength(0);
    expect(event).toMatchObject({ type: 'currency_conversion', isInternal: true, status: 'ok' });
    expect(event!.legs.map((l) => [l.role, l.legKey, l.amount, l.commodity])).toEqual([
      ['principal', 'principal', '-30.10', 'AUD'],
      ['fee', 'fee', '-0.10', 'AUD'],
      ['principal', 'principal', '33.00', 'NZD'],
    ]);
  });

  test('a card payment split across two currencies is one expense with a fee leg', () => {
    const [event] = project([
      tx('nzd', '-18.40', { commodity: 'NZD', providerGroupRef: 'wise:CARD-1' }),
      tx('aud', '-1.20', { providerGroupRef: 'wise:CARD-1' }),
      tx('fee', '-0.01', { providerGroupRef: 'wise:CARD-1', role: 'fee' }),
    ]);
    expect(event).toMatchObject({ type: 'expense', isInternal: false });
    expect(event!.legs).toHaveLength(3);
  });

  test('linked opposite transactions are one internal transfer; principal categories are dropped', () => {
    const decisions = [
      decision('out', 'link', { groupId: 'g1' }),
      decision('in', 'link', { groupId: 'g1' }),
      decision('out', 'category', { categoryId: 'groceries' }, 'principal'),
    ];
    const events = project([tx('out', '-500', { accountId: 'cba' }), tx('in', '500', { accountId: 'wise' })], decisions);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'internal_transfer', isInternal: true, governingDecisionId: 'g1' });
    expect(events[0]!.legs.every((l) => l.categoryId === null)).toBe(true);
  });

  test('a transfer hint, a manual mark, or a missing linked counterpart makes an unmatched transfer', () => {
    const hinted = project([tx('topup', '100', { isTransferHint: true })]);
    expect(hinted[0]).toMatchObject({ type: 'internal_transfer', status: 'unmatched_transfer', isInternal: true });

    const unmarked = project([tx('topup', '100', { isTransferHint: true })], [decision('topup', 'transfer', { isTransfer: false })]);
    expect(unmarked[0]).toMatchObject({ type: 'income', isInternal: false });

    const marked = project([tx('x', '-100')], [decision('x', 'transfer', { isTransfer: true })]);
    expect(marked[0]!.status).toBe('unmatched_transfer');

    const orphan = project([tx('out', '-500')], [decision('out', 'link', { groupId: 'g1' })]);
    expect(orphan[0]!.status).toBe('unmatched_transfer');
  });

  test('unlinking splits the event back into its transactions', () => {
    const decisions = [
      decision('out', 'link', { groupId: 'g1' }),
      decision('in', 'link', { groupId: 'g1' }),
      decision('out', 'link', { groupId: null }),
      decision('in', 'link', { groupId: null }),
    ];
    const events = project([tx('out', '-500', { accountId: 'cba' }), tx('in', '500', { accountId: 'wise' })], decisions);
    expect(events.map((e) => e.type).sort()).toEqual(['expense', 'income']);
  });
});

