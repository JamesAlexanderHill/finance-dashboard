import { describe, expect, test } from 'bun:test';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { UnsupportedStatementError } from '@finance/domain';
import { parseStatement } from '../src';
import type { TextLine } from '../src/pdf';
import { parseWisePdf } from '../src/wise/pdf';

function line(page: number, y: number, ...cells: Array<[number, string]>): TextLine {
  const items = cells.map(([x, text]) => ({ x, right: x + text.length * 5, text }));
  return { page, y, items, text: items.map((i) => i.text).join(' ') };
}

function statement(closing: string, rows: TextLine[]): TextLine[] {
  return [
    line(1, 762, [42, 'Wise Australia Pty Ltd.']),
    line(1, 651, [42, 'AUD statement']),
    line(1, 626, [42, '1 January 2025 [GMT+11:00] - 31 December 2025 [GMT+11:00]']),
    line(1, 570, [303, 'Account number'], [432, 'BSB code']),
    line(1, 554, [44, 'Account Holder Name'], [303, '123456789'], [432, '774-001']),
    line(1, 451, [44, 'AUD on 31 December 2025 [GMT+11:00]'], [501, `${closing} AUD`]),
    line(1, 427, [42, 'Description'], [387, 'Incoming'], [454, 'Outgoing'], [527, 'Amount']),
    ...rows,
    line(2, 16, [36, 'ref:abc'], [546, '1 / 1']),
    line(2, 619, [44, 'Currencies and Send Money are offered by Wise Australia Pty Ltd.']),
  ];
}

// Newest first, as Wise prints them.
const rows = [
  line(1, 332, [42, 'Converted 30.20 AUD to 33.00 NZD (fee: 0.10 AUD)'], [464, '-30.10'], [535, '69.80']),
  line(1, 319, [42, '3 March 2025 | Transaction: BALANCE-1']),
  line(1, 301, [42, 'Wise Charges for: BALANCE-1'], [468, '-0.10'], [534, '99.90']),
  line(1, 288, [42, '3 March 2025 | Transaction: FEE-BALANCE-1']),
  line(1, 208, [42, 'Topped up account'], [393, '100.00'], [529, '100.00']),
  line(1, 195, [42, '2 March 2025 | Transaction: TRANSFER-1']),
];

describe('Wise PDF', () => {
  test('reads newest-first rows with provider IDs, fee roles, group refs and transfer hints', () => {
    const s = parseWisePdf(statement('69.80', rows));
    const account = s.accounts[0]!;
    expect(account).toMatchObject({ identifier: 'AUD', commodity: 'AUD', maskedIdentifier: 'AUD •••• 6789' });
    expect(account.openingBalance).toEqual({ on: '2025-01-01', balance: '0' });
    expect(account.rows.map((r) => [r.postedOn, r.amount, r.providerId, r.role, r.groupRef, r.transferHint])).toEqual([
      ['2025-03-03', '-30.10', 'BALANCE-1', 'principal', 'wise:BALANCE-1', false],
      ['2025-03-03', '-0.10', 'FEE-BALANCE-1', 'fee', 'wise:BALANCE-1', false],
      ['2025-03-02', '100.00', 'TRANSFER-1', 'principal', 'wise:TRANSFER-1', true],
    ]);
  });

  test('rejects a statement whose balances do not reconcile', () => {
    expect(() => parseWisePdf(statement('50.00', rows))).toThrow(UnsupportedStatementError);
  });

  test('an empty currency balance yields an account with no rows', () => {
    const s = parseWisePdf(statement('0.00', []));
    expect(s.accounts[0]!.rows).toHaveLength(0);
    expect(s.accounts[0]!.openingBalance!.balance).toBe('0.00');
  });
});

const fixtures = join(import.meta.dir, '../../../.personal/statements/wise');
const files = existsSync(fixtures) ? readdirSync(fixtures).filter((f) => f.endsWith('.pdf')) : [];

describe.skipIf(files.length === 0)('Wise fixtures', () => {
  for (const file of files) {
    test(`parses and reconciles ${file}`, async () => {
      const s = await parseStatement(new Uint8Array(await Bun.file(join(fixtures, file)).arrayBuffer()), 'application/pdf');
      expect(s.provider).toBe('wise');
      expect(s.accounts[0]!.commodity).toBe(file.slice(0, 3));
    });
  }
});
