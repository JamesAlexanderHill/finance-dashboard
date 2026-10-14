import { describe, expect, test } from 'bun:test';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { UnsupportedStatementError } from '@finance/domain';
import { parseStatement } from '../src';
import { parseAmexPdf } from '../src/amex/pdf';
import type { TextLine } from '../src/pdf';

let y = 0;
/** A positioned line; cells are [left x, text] and right edges assume ~5pt per character. */
function line(page: number, ...cells: Array<[number, string]>): TextLine {
  const items = cells.map(([x, text]) => ({ x, right: x + text.length * 5, text }));
  y -= 12;
  return { page, y, items, text: items.map((i) => i.text).join(' ') };
}
/** Right-aligns text to the amount column (right edge 533) or the foreign spend column (418). */
const amount = (text: string): [number, string] => [533 - text.length * 5, text];
const foreign = (text: string): [number, string] => [418 - text.length * 5, text];
const header = (page: number) =>
  line(page, [14, 'TRANSACTION DATE'], [94, 'TRANSACTION DETAILS'], [353, 'FOREIGN SPEND'], [483, 'AMOUNT ($)']);

interface Options {
  closing?: string;
  paymentsTotal?: string;
  extraSection?: TextLine[];
}

/** A January statement (so December rows belong to the previous year), with made-up values. */
function statement(opts: Options = {}): TextLine[] {
  y = 800;
  return [
    line(1, [421, 'americanexpress.com.au']),
    line(1, [68, 'Example American Express Card'], [421, 'Customer Service']),
    line(1, [421, 'American Express Credit Card']),
    line(1, [14, 'Statement of Account'], [348, 'Page'], [373, '1 of 3']),
    line(1, [14, 'Prepared for'], [337, 'Membership Number'], [520, 'Date']),
    line(1, [14, 'CARD MEMBER'], [292, 'XXXX-XXXXXX-12345'], [439, 'January 16, 2026']),
    line(1, [51, 'OPENING BALANCE'], [145, 'NEW CREDITS'], [238, 'NEW DEBITS'], [332, 'CLOSING BALANCE']),
    line(
      1,
      [83, '500.00'],
      [131, '-'],
      [174, '520.00'],
      [224, '+'],
      [267, '190.00'],
      [317, '='],
      [362, opts.closing ?? '170.00'],
      [499, '$10.00'],
    ),
    line(1, [14, 'Statement Period'], [180, 'From December 17 to January 16, 2026']),
    line(2, [14, 'Statement of Account'], [480, 'Page 2 of 3']),
    line(2, [14, 'TRANSACTION DETAILS']),
    header(2),
    line(2, [14, 'New Payments']),
    line(2, [14, 'December 20'], [94, 'ONLINE PAYMENT RECEIVED - THANKYOU W1234'], amount('500.00')),
    line(2, amount('CR')),
    line(2, [14, 'Total New Payments'], amount(opts.paymentsTotal ?? '500.00')),
    line(2, amount('CR')),
    line(2, [14, 'New Standard Transactions for: CARD MEMBER']),
    line(2, [14, 'Card Number xxxx-xxxxxx-12345']),
    line(2, [14, 'December 14'], [94, 'CORNER GROCER'], [208, 'SYDNEY'], amount('40.00')),
    line(2, [14, 'January 2'], [94, 'EXAMPLE SOFTWARE INC'], [193, 'NEW YORK'], foreign('20.00'), amount('31.00')),
    line(2, foreign('UNITED STATES DOLLAR')),
    line(2, [289, 'AUD 31.00 includes conversion commission of AUD'], [500, '1.00']),
    line(2, [14, 'January 5'], [94, 'HARDWARE STORE'], [208, 'SYDNEY'], amount('20.00')),
    line(2, amount('CR')),
    line(2, [14, 'Total of New Standard Transactions for CARD MEMBER'], amount('51.00')),
    line(3, [14, 'Statement of Account'], [480, 'Page 3 of 3']),
    header(3),
    line(3, [14, 'New Standard Transactions for: SECOND MEMBER']),
    line(3, [14, 'Card Number xxxx-xxxxxx-67890']),
    line(3, [14, 'January 10'], [94, 'CAFE'], [168, 'SYDNEY'], amount('19.00')),
    line(3, [14, 'Total of New Standard Transactions for SECOND MEMBER'], amount('19.00')),
    line(3, [14, 'Account Charges']),
    line(3, [14, 'January 16'], [94, 'MEMBERSHIP FEE'], amount('100.00')),
    line(3, [14, 'Total Account Charges'], amount('100.00')),
    ...(opts.extraSection ?? []),
    line(3, [14, 'Summary of Reward Points']),
  ];
}

describe('American Express statement PDF', () => {
  test('reads one card account with payments, purchases, refunds, foreign spend and charges', () => {
    const s = parseAmexPdf(statement());
    expect(s).toMatchObject({ provider: 'amex', periodStart: '2025-12-17', periodEnd: '2026-01-16', warnings: [] });
    const [account] = s.accounts;
    expect(account).toMatchObject({
      identifier: 'XXXX-XXXXXX-12345',
      maskedIdentifier: '•••• 12345',
      name: 'Example American Express Card',
      accountType: 'credit_card',
      classification: 'liability',
      // A purchase dated before the period is covered by the opening balance's date.
      openingBalance: { on: '2025-12-14', balance: '-500.00' },
      closingBalance: { on: '2026-01-16', balance: '-170.00' },
    });
    expect(account!.rows.map((r) => [r.postedOn, r.description, r.amount, r.role ?? 'principal', r.transferHint ?? false])).toEqual([
      ['2025-12-20', 'ONLINE PAYMENT RECEIVED - THANKYOU W1234', '500.00', 'principal', true],
      ['2025-12-14', 'CORNER GROCER SYDNEY', '-40.00', 'principal', false],
      ['2026-01-02', 'EXAMPLE SOFTWARE INC NEW YORK', '-30.00', 'principal', false],
      ['2026-01-02', 'EXAMPLE SOFTWARE INC NEW YORK conversion commission', '-1.00', 'fee', false],
      ['2026-01-05', 'HARDWARE STORE SYDNEY', '20.00', 'principal', false],
      ['2026-01-10', 'CAFE SYDNEY', '-19.00', 'principal', false],
      ['2026-01-16', 'MEMBERSHIP FEE', '-100.00', 'principal', false],
    ]);
    // The spend and its commission are one event; the rate excludes the commission.
    expect(account!.rows[2]!.groupRef).toBe(account!.rows[3]!.groupRef);
    expect(account!.rows[2]!.groupRef).toBeDefined();
    expect(s.prices).toEqual([
      { symbol: 'USD', exchange: 'FX', on: '2026-01-02', price: '1.5', currency: 'AUD', priceType: 'trade', sourceRow: 2 },
    ]);
  });

  test('rejects statements whose totals do not reconcile, and unknown sections', () => {
    expect(() => parseAmexPdf(statement({ closing: '171.00' }))).toThrow(UnsupportedStatementError);
    expect(() => parseAmexPdf(statement({ paymentsTotal: '400.00' }))).toThrow('Total New Payments mismatch');
    const interest = [line(3, [14, 'Interest Charges']), line(3, [14, 'January 16'], [94, 'PURCHASE INTEREST'], amount('5.00'))];
    expect(() => parseAmexPdf(statement({ extraSection: interest }))).toThrow('Interest Charges');
  });
});

const fixtures = join(import.meta.dir, '../../../.personal/statements/amex');
const files = existsSync(fixtures) ? readdirSync(fixtures).filter((f) => f.endsWith('.pdf')) : [];

describe.skipIf(files.length === 0)('American Express fixtures', () => {
  for (const file of files) {
    test(`parses and reconciles ${file}`, async () => {
      const s = await parseStatement(new Uint8Array(await Bun.file(join(fixtures, file)).arrayBuffer()), 'application/pdf');
      expect(s.provider).toBe('amex');
    });
  }
});
