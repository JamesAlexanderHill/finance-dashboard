import { describe, expect, test } from 'bun:test';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { UnsupportedStatementError } from '@finance/domain';
import { parseCommbankPdf } from '../src/commbank/pdf';
import { parseStatement } from '../src';
import type { TextLine } from '../src/pdf';

/** Builds a positioned line; each cell is [x, text] and right edges assume ~5pt per character. */
function line(page: number, y: number, ...cells: Array<[number, string]>): TextLine {
  const items = cells.map(([x, text]) => ({ x, right: x + text.length * 5, text }));
  return { page, y, items, text: items.map((i) => i.text).join(' ') };
}

const header = (page: number, y: number) =>
  line(page, y, [57, 'Date'], [88, 'Transaction'], [361, 'Debit'], [410, 'Credit'], [498, 'Balance']);

function depositStatement(rows: TextLine[], closing = '95.50 CR'): TextLine[] {
  return [
    line(1, 788, [354, 'Your Statement']),
    line(1, 748, [354, 'Account Number'], [455, '06 1234 00001111']),
    line(1, 715, [354, 'Period'], [423, '1 Dec 2025 - 31 Jan 2026']),
    line(1, 673, [354, 'Enquiries'], [503, '13 2221']),
    line(1, 581, [57, 'Smart Access']),
    header(1, 410),
    line(1, 392, [57, '01 Dec 2025 OPENING BALANCE'], [483, '100.00'], [526, 'CR']),
    ...rows,
    line(2, 299, [57, '31 Jan 2026 CLOSING BALANCE'], [483, closing]),
  ];
}

describe('Commbank home-loan PDF', () => {
  const loan = [
    line(1, 788, [377, 'Your Statement']),
    line(1, 756, [354, 'Account number'], [516, '000111222']),
    line(1, 737, [354, 'Statement period'], [443, '1 Jan 2026'], [507, '31 Jan 2026']),
    line(2, 470, [56, 'Investment Home Loan Transactions']),
    line(2, 449, [56, 'Date'], [98, 'Transaction description'], [330, 'Debits'], [403, 'Credits'], [522, 'Balance']),
    line(2, 412, [56, '01 Jan'], [98, 'Opening balance'], [492, '$1,000.00 DR']),
    line(2, 275, [56, '10 Jan'], [98, 'Interest charged'], [323, '5.00'], [491, '$1,005.00 DR']),
    line(2, 256, [56, '10 Jan'], [98, 'Repayment/Payment'], [395, '$105.00'], [491, '$900.00 DR']),
    line(2, 75, [56, '31 Jan'], [98, 'Closing balance'], [492, '$900.00 DR']),
  ];

  test('signs balances as owed and hints repayments, not interest, as transfers', () => {
    const account = parseCommbankPdf(loan).accounts[0]!;
    expect(account).toMatchObject({ classification: 'liability', accountType: 'loan', name: 'Investment Home Loan' });
    expect(account.openingBalance!.balance).toBe('-1000.00');
    expect(account.rows.map((r) => [r.description, r.amount, r.transferHint ?? false])).toEqual([
      ['Interest charged', '-5.00', false],
      ['Repayment/Payment', '105.00', true],
    ]);
  });
});

describe('Commbank deposit PDF', () => {
  const rows = [
    line(1, 375, [57, '30 Dec Coffee Shop SYDNEY']),
    line(1, 365, [88, 'Card xx1234'], [370, '4.50'], [484, '95.50 CR']),
    header(2, 410),
    line(2, 380, [57, '02 Jan'], [88, 'Salary ACME']),
    line(2, 370, [88, 'PAY 123'], [405, '1,000.00'], [484, '1,095.50 CR']),
    line(2, 355, [57, '03 Jan Rent'], [352, '1,000.00'], [484, '95.50 CR']),
  ];

  test('reads rows, signs by column and infers the year from the statement period', () => {
    const s = parseCommbankPdf(depositStatement(rows));
    const account = s.accounts[0]!;
    expect(account).toMatchObject({ identifier: '06123400001111', name: 'Smart Access', classification: 'asset' });
    expect(account.openingBalance).toEqual({ on: '2025-12-01', balance: '100.00' });
    expect(account.rows.map((r) => [r.postedOn, r.amount, r.description])).toEqual([
      ['2025-12-30', '-4.50', 'Coffee Shop SYDNEY Card xx1234'],
      ['2026-01-02', '1000.00', 'Salary ACME PAY 123'],
      ['2026-01-03', '-1000.00', 'Rent'],
    ]);
  });

  test('rejects a statement whose running balances do not reconcile', () => {
    expect(() => parseCommbankPdf(depositStatement(rows, '90.00 CR'))).toThrow(UnsupportedStatementError);
  });
});

// Real statements live outside git in .personal/statements/commbank (see docs). Skipped when absent.
const fixtures = join(import.meta.dir, '../../../.personal/statements/commbank');
const files = existsSync(fixtures) ? readdirSync(fixtures, { recursive: true, encoding: 'utf8' }).filter((f) => f.endsWith('.pdf')) : [];

describe.skipIf(files.length === 0)('Commbank fixtures', () => {
  for (const file of files) {
    test(`parses and reconciles ${file}`, async () => {
      const bytes = new Uint8Array(await Bun.file(join(fixtures, file)).arrayBuffer());
      const s = await parseStatement(bytes, 'application/pdf');
      expect(s.accounts).toHaveLength(1);
      expect(s.accounts[0]!.closingBalance).toBeDefined();
    });
  }
});
