import { describe, expect, test } from 'bun:test';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { UnsupportedStatementError } from '@finance/domain';
import { parseStatement } from '../src';
import { parseIbkrPdf } from '../src/ibkr/pdf';
import type { TextLine } from '../src/pdf';

let y = 0;
/** A positioned line; cells are [left x, text] and right edges assume ~5pt per character. */
function line(page: number, ...cells: Array<[number, string]>): TextLine {
  const items = cells.map(([x, text]) => ({ x, right: x + text.length * 5, text }));
  y -= 11;
  return { page, y, items, text: items.map((i) => i.text).join(' ') };
}
/** A trade row as IBKR prints it: the date just above, the time just below, then a gap. */
function tradeRow(page: number, date: string, time: string, ...cells: Array<[number, string]>): TextLine[] {
  const at = (dy: number, cs: Array<[number, string]>): TextLine => {
    const items = cs.map(([x, text]) => ({ x, right: x + text.length * 5, text }));
    return { page, y: y - dy, items, text: items.map((i) => i.text).join(' ') };
  };
  y -= 14;
  const rows = [at(0, [[146, date]]), at(3, cells), at(7, [[146, time]])];
  y -= 11;
  return rows;
}
/** Right-aligns a number under a header whose right edge is `right`. */
const r = (right: number, text: string): [number, string] => [right - text.length * 5, text];

function statement(opts: { quantity?: string; extraCashLine?: string; endingAud?: string } = {}): TextLine[] {
  y = 0;
  const qty = opts.quantity ?? '3';
  const tradeHeader: Array<[number, string]> = [
    [38, 'Symbol'],
    [146, 'Date/Time'],
    [289, 'Quantity'],
    [341, 'T. Price'],
    [436, 'Proceeds'],
    [482, 'Comm/Fee'],
    [737, 'Code'],
  ];
  const fxHeader: Array<[number, string]> = [
    [38, 'Symbol'],
    [146, 'Date/Time'],
    [289, 'Quantity'],
    [341, 'T. Price'],
    [436, 'Proceeds'],
    [472, 'Comm in AUD'],
    [737, 'Code'],
  ];
  const right = (header: Array<[number, string]>, name: string) => {
    const h = header.find(([, t]) => t === name)!;
    return h[0] + h[1].length * 5;
  };
  return [
    line(1, [50, 'Activity Statement']),
    line(1, [72, 'July 1, 2024 - June 30, 2025']),
    line(1, [125, 'Interactive Brokers Australia Pty Ltd.']),
    line(1, [40, 'Account Information']),
    line(1, [38, 'Account'], [182, 'U1234567']),
    line(1, [38, 'Base Currency'], [182, 'AUD']),
    line(1, [40, 'Mark-to-Market Performance Summary']),
    line(1, [38, 'Symbol'], [158, 'Prior'], [212, 'Current']),
    line(1, [38, 'Stocks']),
    line(1, [38, 'MSFT'], r(183, '0'), r(237, qty)),
    line(1, [38, 'Forex']),
    line(2, [40, 'Cash Report']),
    line(2, [38, 'Base Currency Summary']),
    line(2, [38, 'Starting Cash'], r(760, '0.00')),
    line(2, [38, 'AUD']),
    line(2, [38, 'Starting Cash'], r(760, '0.00')),
    line(2, [38, 'Deposits'], r(760, '2,000.00')),
    ...(opts.extraCashLine ? [line(2, [38, opts.extraCashLine], r(760, '5.00'))] : []),
    line(2, [38, 'Ending Cash'], r(760, opts.endingAud ?? '200.00')),
    line(2, [38, 'USD']),
    line(2, [38, 'Starting Cash'], r(760, '0.00')),
    line(2, [38, 'Ending Cash'], r(760, '0.00')),
    line(2, [40, 'Open Positions']),
    line(2, [38, 'Symbol'], [237, 'Quantity'], [294, 'Mult'], [500, 'Close Price']),
    line(2, [38, 'Stocks']),
    line(2, [38, 'USD']),
    line(2, [38, 'MSFT'], r(282, qty), r(314, '1'), r(555, '410.0000')),
    line(2, [40, 'Trades']),
    line(2, ...tradeHeader),
    line(2, [38, 'Stocks']),
    line(2, [38, 'USD']),
    ...tradeRow(
      2,
      '2024-08-01,',
      '10:00:00',
      [38, 'MSFT'],
      r(right(tradeHeader, 'Quantity'), qty),
      r(right(tradeHeader, 'T. Price'), '400.0000'),
      r(right(tradeHeader, 'Proceeds'), '-1200.00'),
      r(right(tradeHeader, 'Comm/Fee'), '-1.00'),
      [749, 'O'],
    ),
    line(2, [44, 'Total MSFT']),
    line(2, ...fxHeader),
    line(2, [38, 'Forex']),
    line(2, [38, 'USD']),
    ...tradeRow(
      2,
      '2024-08-01,',
      '09:59:00',
      [38, 'AUD.USD'],
      r(right(fxHeader, 'Quantity'), '-1800'),
      r(right(fxHeader, 'T. Price'), '0.6672'),
      r(right(fxHeader, 'Proceeds'), '1201.00'),
      r(right(fxHeader, 'Comm in AUD'), '0.00'),
    ),
    line(2, [40, 'Deposits & Withdrawals']),
    line(2, [38, 'Date'], [107, 'Description'], [355, 'Amount']),
    line(2, [38, 'AUD']),
    line(2, [38, '2024-07-20'], [107, 'Electronic Fund Transfer'], r(380, '2,000.00')),
    line(3, [40, 'Financial Instrument Information']),
    line(3, [40, 'Symbol'], [147, 'Description'], [326, 'Security ID'], [470, 'Listing Exch'], [541, 'Multiplier'], [613, 'Type']),
    line(3, [40, 'Stocks']),
    line(3, [40, 'MSFT'], [147, 'MICROSOFT CORP'], [326, 'US5949181045'], [470, 'NASDAQ'], r(546, '1'), [613, 'COMMON']),
    line(3, [40, 'Codes']),
  ];
}

describe('IBKR activity statement PDF', () => {
  test('builds cash accounts per currency, a holding account, linked trade and conversion rows, and prices', () => {
    const s = parseIbkrPdf(statement());
    const [aud, usd, amd] = s.accounts;
    expect(aud!.rows.map((r) => [r.amount, r.transferHint ?? false])).toEqual([
      ['2000.00', true],
      ['-1800', false],
    ]);
    expect(usd!.rows.map((r) => [r.amount, r.role ?? 'principal'])).toEqual([
      ['-1200.00', 'principal'],
      ['-1.00', 'fee'],
      ['1201.00', 'principal'],
    ]);
    expect(amd).toMatchObject({
      commodity: 'XNAS:MSFT',
      instrument: { symbol: 'MSFT', exchange: 'XNAS', currency: 'USD', isin: 'US5949181045' },
    });
    // Cash, commission and units of the buy share one reference; both sides of the conversion share another.
    expect(new Set([usd!.rows[0]!.groupRef, usd!.rows[1]!.groupRef, amd!.rows[0]!.groupRef]).size).toBe(1);
    expect(aud!.rows[1]!.groupRef).toBe(usd!.rows[2]!.groupRef);
    expect(s.prices!.map((p) => [p.symbol, p.price, p.priceType])).toEqual([
      ['MSFT', '400.0000', 'trade'],
      ['MSFT', '410.0000', 'daily'],
    ]);
  });

  test('rejects cash that does not reconcile, unknown cash lines and sells', () => {
    expect(() => parseIbkrPdf(statement({ endingAud: '11.00' }))).toThrow(UnsupportedStatementError);
    expect(() => parseIbkrPdf(statement({ extraCashLine: 'Dividends' }))).toThrow('Dividends');
    expect(() => parseIbkrPdf(statement({ quantity: '-3' }))).toThrow(UnsupportedStatementError);
  });
});

const fixtures = join(import.meta.dir, '../../../.personal/statements/IBKR');
const files = existsSync(fixtures) ? readdirSync(fixtures).filter((f) => f.endsWith('.pdf')) : [];

describe.skipIf(files.length === 0)('IBKR fixtures', () => {
  for (const file of files) {
    test(`parses and reconciles ${file}`, async () => {
      const s = await parseStatement(new Uint8Array(await Bun.file(join(fixtures, file)).arrayBuffer()), 'application/pdf');
      expect(s.provider).toBe('ibkr');
    });
  }
});
