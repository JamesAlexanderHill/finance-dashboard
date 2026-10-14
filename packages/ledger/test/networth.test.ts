import { describe, expect, test } from 'bun:test';
import { netWorthAt, type AccountValuationInput } from '../src';

const cash: AccountValuationInput = {
  id: 'cash',
  name: 'Everyday',
  classification: 'asset',
  kind: 'currency',
  currency: 'AUD',
  opening: { on: '2026-01-01', quantity: '1000' },
  movements: [{ on: '2026-01-10', quantity: '-200' }],
  coverageEnd: '2026-01-31',
};
const loan: AccountValuationInput = {
  id: 'loan',
  name: 'Home loan',
  classification: 'liability',
  kind: 'currency',
  currency: 'AUD',
  opening: { on: '2026-01-01', quantity: '-5000' },
  movements: [],
  coverageEnd: '2026-01-31',
};
const shares: AccountValuationInput = {
  id: 'shares',
  name: 'MSFT',
  classification: 'asset',
  kind: 'instrument',
  currency: 'USD',
  instrumentId: 'msft',
  opening: { on: '2026-01-01', quantity: '2' },
  movements: [],
  coverageEnd: '2026-01-31',
};
const prices = new Map([['msft', [{ on: '2026-01-29', price: '400', currency: 'USD', priceType: 'daily' as const }]]]);
const fx = new Map([['USD', [{ on: '2026-01-29', price: '1.5', currency: 'AUD', priceType: 'daily' as const }]]]);

describe('net worth', () => {
  test('values cash, liabilities and holdings in AUD', () => {
    const p = netWorthAt([cash, loan, shares], '2026-01-30', prices, fx);
    expect(p).toMatchObject({ assets: '2000', liabilities: '5000', netWorth: '-3000', partial: false, stale: false });
    expect(p.accounts.find((a) => a.id === 'shares')!.aud).toBe('1200');
  });

  test('a missing FX rate makes the value unavailable and the total partial, never converted 1:1', () => {
    const p = netWorthAt([cash, shares], '2026-01-30', prices, new Map());
    expect(p.accounts.find((a) => a.id === 'shares')).toMatchObject({ aud: null, status: 'missing' });
    expect(p).toMatchObject({ assets: '800', partial: true });
  });

  test('stale prices and balances carried past their statement mark the point stale', () => {
    const p = netWorthAt([cash, shares], '2026-03-15', prices, fx);
    expect(p.stale).toBe(true);
    expect(p.accounts.find((a) => a.id === 'cash')!.notes).toContain('Balance last known 2026-01-31');
  });

  test('before tracking starts, an account that already held money makes the point partial', () => {
    expect(netWorthAt([cash], '2025-12-31', prices, fx)).toMatchObject({ partial: true, assets: '0' });
    const opened = { ...cash, opening: { on: '2026-01-01', quantity: '0' } };
    expect(netWorthAt([opened], '2025-12-31', prices, fx)).toMatchObject({ partial: false });
  });

  test('manual accounts use their latest value on or before the date', () => {
    const house: AccountValuationInput = {
      id: 'house',
      name: 'House',
      classification: 'asset',
      kind: 'currency',
      currency: 'AUD',
      movements: [],
      manualValues: [
        { on: '2025-06-01', quantity: '700000' },
        { on: '2026-01-15', quantity: '750000' },
      ],
    };
    expect(netWorthAt([house], '2026-01-20', prices, fx).assets).toBe('750000');
    expect(netWorthAt([house], '2025-12-01', prices, fx)).toMatchObject({ assets: '700000', stale: true });
  });

  test('an archived account counts up to its closing date and is excluded, never stale, after it', () => {
    const closed = { ...cash, closedOn: '2026-01-31' };
    expect(netWorthAt([closed], '2026-01-31', prices, fx)).toMatchObject({ assets: '800', stale: false });
    const after = netWorthAt([closed, loan], '2026-06-30', prices, fx);
    expect(after).toMatchObject({ assets: '0', liabilities: '5000', partial: false });
    expect(after.accounts.find((a) => a.id === 'cash')).toMatchObject({ status: 'closed', aud: null, notes: [] });
    expect(after.accounts.find((a) => a.id === 'loan')!.status).toBe('stale');
  });
});
