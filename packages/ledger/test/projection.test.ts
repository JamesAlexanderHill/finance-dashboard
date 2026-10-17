import { describe, expect, test } from 'bun:test';
import {
  ItemisationError,
  projectEvents,
  validateItemisation,
  type ActiveTransaction,
  type AssignmentRecord,
  type DecisionRecord,
  type LineItem,
} from '../src';

const tx = (id: string, amount: string, extra: Partial<ActiveTransaction> = {}): ActiveTransaction => ({
  id,
  accountId: 'acc',
  postedOn: '2026-01-05',
  description: `Tx ${id}`,
  amount,
  commodity: 'AUD',
  commodityKind: 'currency',
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

const assignment = (transactionId: string, legKey: string, kind: AssignmentRecord['kind'], payload: unknown): AssignmentRecord => ({
  id: `a${++seq}`,
  seq,
  transactionId,
  legKey,
  kind,
  payload,
});
const category = (transactionId: string, categoryId: string, legKey = 'principal') =>
  assignment(transactionId, legKey, 'category', { categoryId });
const line = (id: string, transactionId: string, position: number, amount: string, description = ''): LineItem => ({
  id,
  transactionId,
  position,
  amount,
  description,
});
const empty = {
  decisions: [] as DecisionRecord[],
  lineItems: [] as LineItem[],
  assignments: [] as AssignmentRecord[],
  categories,
  openingBalances: [],
};

describe('event projection', () => {
  test('is deterministic and starts every leg uncategorised', () => {
    const input = { ...empty, transactions: [tx('a', '-30'), tx('b', '1000')] };
    const first = projectEvents(input);
    expect(projectEvents(input)).toEqual(first);
    expect(first.map((e) => e.type).sort()).toEqual(['expense', 'income']);
    expect(first.flatMap((e) => e.legs).every((l) => l.categoryId === null)).toBe(true);
  });

  test('the latest category assignment wins and a refund keeps its expense category', () => {
    const assignments = [category('a', 'salary'), category('a', 'groceries'), category('r', 'groceries')];
    const events = projectEvents({ ...empty, transactions: [tx('a', '-30'), tx('r', '5')], assignments });
    expect(events.find((e) => e.transactionIds[0] === 'a')!.legs[0]!.categoryId).toBe('groceries');
    expect(events.find((e) => e.transactionIds[0] === 'r')!.type).toBe('refund');
  });

  test('line items become the legs, in order, keyed by line item id', () => {
    const lineItems = [line('l2', 'a', 1, '-20', 'Bread'), line('l1', 'a', 0, '-10', 'Milk')];
    const [event] = projectEvents({ ...empty, transactions: [tx('a', '-30')], lineItems });
    expect(event!.legs.map((l) => [l.legKey, l.role, l.amount, l.description])).toEqual([
      ['line:l1', 'line_item', '-10', 'Milk'],
      ['line:l2', 'line_item', '-20', 'Bread'],
    ]);
  });

  test('a line keeps its category when other lines change', () => {
    const assignments = [category('a', 'groceries', 'line:l1')];
    const before = projectEvents({
      ...empty,
      transactions: [tx('a', '-30')],
      lineItems: [line('l1', 'a', 0, '-10'), line('l2', 'a', 1, '-20')],
      assignments,
    });
    // l2 is replaced by two new lines and l1 moves to the end.
    const after = projectEvents({
      ...empty,
      transactions: [tx('a', '-30')],
      lineItems: [line('l3', 'a', 0, '-5'), line('l4', 'a', 1, '-15'), line('l1', 'a', 2, '-10')],
      assignments,
    });
    const categoryOf = (events: typeof before, key: string) => events[0]!.legs.find((l) => l.legKey === key)?.categoryId;
    expect(categoryOf(before, 'line:l1')).toBe('groceries');
    expect(categoryOf(after, 'line:l1')).toBe('groceries');
    expect(after[0]!.legs.filter((l) => l.categoryId).map((l) => l.legKey)).toEqual(['line:l1']);
  });

  test('without valid line items the transaction itself is the leg', () => {
    const unbalanced = [line('l1', 'a', 0, '-10'), line('l2', 'a', 1, '-15')];
    const [event] = projectEvents({ ...empty, transactions: [tx('a', '-30')], lineItems: unbalanced });
    expect(event!.legs.map((l) => [l.legKey, l.role, l.amount])).toEqual([['principal', 'principal', '-30']]);
  });

  test('categories pointing at a removed category fall back to Uncategorised', () => {
    const [event] = projectEvents({ ...empty, transactions: [tx('a', '-30')], assignments: [category('a', 'gone')] });
    expect(event!.legs[0]!.categoryId).toBeNull();
  });
});

describe('itemisation validation', () => {
  test('line items must sum exactly', () => {
    expect(() =>
      validateItemisation('-30', [
        { amount: '-10', description: '' },
        { amount: '-19.99', description: '' },
      ]),
    ).toThrow(ItemisationError);
    expect(() =>
      validateItemisation('-30', [
        { amount: '-10', description: '' },
        { amount: '-20', description: '' },
      ]),
    ).not.toThrow();
  });
});

describe('grouping and transfers', () => {
  const project = (transactions: ActiveTransaction[], decisions: DecisionRecord[] = [], assignments: AssignmentRecord[] = []) =>
    projectEvents({ ...empty, transactions, decisions, assignments });

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
    const decisions = [decision('out', 'link', { groupId: 'g1' }), decision('in', 'link', { groupId: 'g1' })];
    const events = project([tx('out', '-500', { accountId: 'cba' }), tx('in', '500', { accountId: 'wise' })], decisions, [
      category('out', 'groceries'),
    ]);
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

  test('cash out and units in of an instrument form an investment buy', () => {
    const [event] = project([
      tx('cash', '-1200.00', { accountId: 'vanguard-cash', providerGroupRef: 'vanguard:buy:1' }),
      tx('units', '12', {
        accountId: 'vanguard-vap',
        commodity: 'XASX:VAP',
        commodityKind: 'instrument',
        providerGroupRef: 'vanguard:buy:1',
      }),
    ]);
    expect(event).toMatchObject({ type: 'investment_buy', isInternal: true });
    expect(event!.legs.every((l) => l.categoryId === null)).toBe(true);
  });
});
