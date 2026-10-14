import { describe, expect, test } from 'bun:test';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { UnsupportedStatementError } from '@finance/domain';
import { parseStatement } from '../src';
import type { TextLine } from '../src/pdf';
import { parseVanguardPdf } from '../src/vanguard/pdf';

function line(page: number, y: number, ...cells: Array<[number, string]>): TextLine {
  const items = cells.map(([x, text]) => ({ x, right: x + text.length * 5, text }));
  return { page, y, items, text: items.map((i) => i.text).join(' ') };
}

function statement(opts: { tradeValue?: string; description?: string } = {}): TextLine[] {
  return [
    line(1, 545, [43, 'Vanguard Personal Investor Annual Statement']),
    line(1, 526, [43, 'Period ending 30 June 2025']),
    line(1, 485, [43, 'Account number:'], [193, '12345678']),
    line(1, 401, [48, 'Portfolio opening value as at 1 July 2024'], [499, '$0.00']),
    line(1, 362, [48, 'Withdrawals from Vanguard Cash Account'], [526, '$0.00']),
    line(2, 635, [48, 'Investment type'], [514, 'Value ($)']),
    line(2, 615, [48, 'Vanguard Cash Account'], [521, '10.00']),
    line(2, 595, [48, 'ETFs'], [509, '1,940.00']),
    line(2, 576, [48, 'Income on investments due not yet received'], [530, '0.00']),
    line(2, 556, [48, 'Total cash and investment value'], [504, '1,950.00']),
    line(2, 366, [48, 'Code'], [125, 'Investment product'], [323, 'Quantity'], [394, 'price ($)'], [445, 'Price date'], [514, 'Value ($)']),
    line(
      2,
      317,
      [48, 'VAS'],
      [125, 'Vanguard Australian Shares Index ETF'],
      [334, '20.00'],
      [394, '97.000'],
      [445, '30-Jun-25'],
      [514, '1,940.00'],
    ),
    line(2, 258, [48, 'Total ETFs'], [504, '1,940.00']),
    line(3, 690, [43, 'Your Vanguard Cash Account transaction details']),
    line(3, 657, [43, 'Account number:'], [144, '987654321']),
    line(3, 621, [48, 'Effective date'], [125, 'Transaction description'], [319, 'Debits ($)'], [406, 'Credits ($)'], [505, 'Balance ($)']),
    line(3, 601, [48, '1-Jul-2024'], [125, 'Opening balance'], [518, '0.00']),
    line(3, 582, [125, 'BPAY DEPOSIT']),
    line(3, 576, [48, '02-Jul-2024'], [412, '1,910.00'], [514, '1,910.00']),
    line(3, 571, [125, 'CBA202406290000000001']),
    line(3, 552, [48, '05-Jul-2024'], [125, opts.description ?? 'Buy transaction of VAS'], [322, '1,900.01'], [526, '9.99']),
    line(3, 532, [48, '17-Jul-2024'], [125, 'DIV: VAS.XASX.AU @ AUD 0.0005'], [428, '0.01'], [526, '10.00']),
    line(3, 512, [48, '30-Jun-2025'], [125, 'Closing balance'], [526, '10.00']),
    line(
      4,
      414,
      [48, 'Trade date'],
      [116, 'Settlement date'],
      [192, 'Investment product'],
      [328, 'Transaction description'],
      [489, 'Quantity'],
      [551, 'Price ($)'],
      [600, 'Brokerage fee ($)'],
      [683, 'Currency'],
      [761, 'Value ($)'],
    ),
    line(4, 395, [192, 'Vanguard Australian Shares'], [328, 'Buy Vanguard Australian Shares']),
    line(
      4,
      390,
      [48, '05-Jul-2024'],
      [116, '09-Jul-2024'],
      [500, '20.00'],
      [556, '95.000'],
      [648, '0.00'],
      [700, 'AUD'],
      [760, opts.tradeValue ?? '1,900.00'],
    ),
    line(4, 385, [192, 'Index ETF(VAS)'], [328, 'Index ETF']),
    line(4, 362, [43, 'Notes:']),
  ];
}

describe('Vanguard PDF', () => {
  test('reads the cash account, holdings, prices and links each buy across both accounts', () => {
    const s = parseVanguardPdf(statement());
    const [cash, vas] = s.accounts;
    expect(cash).toMatchObject({ identifier: 'CASH', commodity: 'AUD', maskedIdentifier: 'Cash •••• 4321' });
    expect(cash!.rows.map((r) => [r.postedOn, r.amount, r.transferHint ?? false, r.providerId, r.counterpartDate])).toEqual([
      ['2024-07-02', '1910.00', true, 'BPAY:CBA202406290000000001', '2024-06-29'],
      ['2024-07-05', '-1900.01', false, undefined, undefined],
      ['2024-07-17', '0.01', false, undefined, undefined],
    ]);
    expect(vas).toMatchObject({
      identifier: 'VAS',
      commodity: 'XASX:VAS',
      instrument: { symbol: 'VAS', exchange: 'XASX', name: 'Vanguard Australian Shares Index ETF' },
    });
    expect(vas!.openingBalance!.balance).toBe('0');
    expect(vas!.closingBalance!.balance).toBe('20.00');
    // A cent of rounding between the cash debit and the trade value is tolerated.
    expect(vas!.rows[0]!.groupRef).toBe(cash!.rows[1]!.groupRef);
    expect(s.prices).toEqual([
      { symbol: 'VAS', exchange: 'XASX', on: '2024-07-05', price: '95.000', currency: 'AUD', priceType: 'trade', sourceRow: 3 },
      { symbol: 'VAS', exchange: 'XASX', on: '2025-06-30', price: '97.000', currency: 'AUD', priceType: 'daily' },
    ]);
  });

  test('rejects buys whose cash and trade values disagree, and transactions it does not understand', () => {
    expect(() => parseVanguardPdf(statement({ tradeValue: '1,800.00' }))).toThrow(UnsupportedStatementError);
    expect(() => parseVanguardPdf(statement({ description: 'Buy transaction of VGS' }))).toThrow(UnsupportedStatementError);
  });
});

const fixtures = join(import.meta.dir, '../../../.personal/statements/vanguard');
const files = existsSync(fixtures) ? readdirSync(fixtures).filter((f) => f.endsWith('.pdf')) : [];

describe.skipIf(files.length === 0)('Vanguard fixtures', () => {
  for (const file of files) {
    test(`parses and reconciles ${file}`, async () => {
      const s = await parseStatement(new Uint8Array(await Bun.file(join(fixtures, file)).arrayBuffer()), 'application/pdf');
      expect(s.provider).toBe('vanguard');
      const linked = s.accounts.flatMap((a) => a.rows).filter((r) => r.groupRef);
      expect(linked.length % 2).toBe(0);
    });
  }
});
