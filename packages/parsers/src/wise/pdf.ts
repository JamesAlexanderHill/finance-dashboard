import { UnsupportedStatementError, type ParsedRow, type ParsedStatement } from '@finance/domain';
import { add, eq, isoDate, sub, type DecimalString, type IsoDate } from '@finance/shared';
import type { TextItem, TextLine } from '../pdf';

export const WISE_PDF_PARSER_ID = 'wise-pdf';
export const WISE_PDF_PARSER_VERSION = '1.0.0';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DATE_RE = new RegExp(`(\\d{1,2}) (${MONTHS.join('|')}) (\\d{4})`);
const DATE_RE_G = new RegExp(DATE_RE.source, 'g');
const AMOUNT_RE = /^-?\d{1,3}(?:,\d{3})*\.\d{2}$/;
const TITLE_RE = /^([A-Z]{3}) statement$/;
/** Text left of this x is page furniture (statement reference, page numbers). */
const LEFT_MARGIN = 40;

interface Columns {
  incomingRight: number;
  outgoingRight: number;
  /** Amounts starting right of this are running balances. */
  balanceFrom: number;
}

interface PendingRow {
  parts: string[];
  lines: string[];
  amount?: DecimalString;
  balance?: DecimalString;
}

const toIso = (m: RegExpMatchArray): IsoDate => isoDate(Number(m[3]), MONTHS.indexOf(m[2]!) + 1, Number(m[1]));

export function detectWise(lines: TextLine[]): boolean {
  const page1 = lines.filter((l) => l.page === 1).map((l) => l.text);
  return page1.some((t) => t.startsWith('Wise ')) && page1.some((t) => TITLE_RE.test(t));
}

/**
 * Parses a Wise per-currency balance statement (one currency balance per PDF).
 * Rows are listed newest first; each row is followed by a metadata line with its date and
 * Wise transaction ID, which becomes the provider ID. Fee rows (`FEE-…`) share a group
 * reference with the row they charge for, and the same conversion or card payment appears
 * in every currency file it touched under one ID, so they group into one event.
 */
export function parseWisePdf(lines: TextLine[]): ParsedStatement {
  if (!detectWise(lines)) throw new UnsupportedStatementError('Not a recognised Wise statement');
  const content = lines
    .filter((l) => l.items[0]!.x >= LEFT_MARGIN)
    .map((l) => ({ ...l, text: l.items.map((i) => i.text).join(' ') }));
  const page1 = content.filter((l) => l.page === 1);

  const currency = page1.map((l) => l.text.match(TITLE_RE)?.[1]).find(Boolean);
  if (!currency) throw new UnsupportedStatementError('Statement currency not found');

  const periodLine = page1.find((l) => (l.text.match(DATE_RE_G) ?? []).length >= 2 && l.text.includes('[GMT'));
  const periodDates = periodLine ? [...periodLine.text.matchAll(DATE_RE_G)] : [];
  if (periodDates.length < 2) throw new UnsupportedStatementError('Statement period not found');
  const periodStart = toIso(periodDates[0]!);
  const periodEnd = toIso(periodDates[1]!);

  const closingLine = page1.find((l) => l.text.startsWith(`${currency} on `));
  const closingValue = closingLine?.items.at(-1)?.text.match(new RegExp(`^(-?[\\d,]+\\.\\d{2}) ${currency}$`))?.[1];
  if (!closingValue) throw new UnsupportedStatementError('Closing balance not found');
  const closingBalance = closingValue.replace(/,/g, '');

  const rows = readRows(content);
  const opening = verifyAndOpen(rows, closingBalance);
  const accountNumber = readAccountNumber(page1);

  return {
    parserId: WISE_PDF_PARSER_ID,
    parserVersion: WISE_PDF_PARSER_VERSION,
    provider: 'wise',
    institutionName: 'Wise',
    periodStart,
    periodEnd,
    accounts: [
      {
        // One Wise account per currency balance (ADR 0011); bank details differ per currency or are absent.
        identifier: currency,
        maskedIdentifier: accountNumber ? `${currency} •••• ${accountNumber.slice(-4)}` : currency,
        name: `Wise ${currency}`,
        accountType: 'bank',
        classification: 'asset',
        commodity: currency,
        openingBalance: { on: periodStart, balance: opening },
        closingBalance: { on: periodEnd, balance: closingBalance },
        rows,
      },
    ],
    warnings: [],
  };
}

function readAccountNumber(page1: TextLine[]): string | null {
  const labelIndex = page1.findIndex((l) => l.items.some((i) => i.text === 'Account number' || i.text === 'IBAN'));
  if (labelIndex < 0) return null;
  const label = page1[labelIndex]!.items.find((i) => i.text === 'Account number' || i.text === 'IBAN')!;
  const value = page1[labelIndex + 1]?.items.find((i) => Math.abs(i.x - label.x) < 4);
  return value ? value.text.replace(/\W/g, '') : null;
}

function readColumns(line: TextLine): Columns | null {
  const find = (text: string) => line.items.find((i) => i.text === text);
  const [incoming, outgoing, amount] = [find('Incoming'), find('Outgoing'), find('Amount')];
  if (!find('Description') || !incoming || !outgoing || !amount) return null;
  return { incomingRight: incoming.right, outgoingRight: outgoing.right, balanceFrom: (outgoing.right + amount.x) / 2 };
}

function readRows(lines: TextLine[]): ParsedRow[] {
  const rows: ParsedRow[] = [];
  let columns: Columns | null = null;
  let pending: PendingRow = { parts: [], lines: [] };

  for (const line of lines) {
    if (!columns) {
      columns = readColumns(line);
      continue;
    }
    if (line.text.startsWith('Currencies and Send Money') || line.text.startsWith('Need help?')) break;

    const meta = line.text.match(/Transaction: ([A-Z0-9-]+)/);
    const date = line.text.match(DATE_RE);
    if (meta && date && line.text.startsWith(date[0])) {
      if (pending.amount === undefined) throw new UnsupportedStatementError(`No amount found for ${meta[1]}`);
      const providerId = meta[1]!;
      const description = pending.parts.join(' ').replace(/\s+/g, ' ').trim();
      rows.push({
        rowIndex: rows.length,
        postedOn: toIso(date),
        description,
        amount: pending.amount,
        runningBalance: pending.balance,
        providerId,
        groupRef: `wise:${providerId.replace(/^FEE-/, '')}`,
        role: providerId.startsWith('FEE-') ? 'fee' : 'principal',
        transferHint: description.startsWith('Topped up account'),
        raw: { page: line.page, lines: [...pending.lines, line.text] },
      });
      pending = { parts: [], lines: [] };
      continue;
    }

    pending.lines.push(line.text);
    for (const item of line.items) classify(item, columns, pending);
  }
  return rows;
}

function classify(item: TextItem, columns: Columns, pending: PendingRow) {
  if (!AMOUNT_RE.test(item.text)) {
    pending.parts.push(item.text);
    return;
  }
  const value = item.text.replace(/,/g, '');
  if (item.x >= columns.balanceFrom) {
    pending.balance = value;
    return;
  }
  const incoming = Math.abs(item.right - columns.incomingRight) < Math.abs(item.right - columns.outgoingRight);
  // Outgoing amounts are printed with a minus sign; incoming ones without.
  pending.amount = incoming ? value.replace(/^-/, '') : value.startsWith('-') ? value : `-${value}`;
}

/** Rows are newest first: replay them oldest first and check every running balance. Returns the opening balance. */
function verifyAndOpen(rows: ParsedRow[], closing: DecimalString): DecimalString {
  if (rows.length === 0) return closing;
  const chronological = [...rows].reverse();
  const oldest = chronological[0]!;
  if (oldest.runningBalance === undefined) throw new UnsupportedStatementError('Running balance missing on oldest row');
  const opening = sub(oldest.runningBalance, oldest.amount);
  let balance = opening;
  for (const row of chronological) {
    balance = add(balance, row.amount);
    if (row.runningBalance !== undefined && !eq(balance, row.runningBalance)) {
      throw new UnsupportedStatementError(
        `Running balance mismatch on ${row.postedOn} ${row.providerId}: expected ${row.runningBalance}, computed ${balance}`,
      );
    }
  }
  if (!eq(balance, closing)) throw new UnsupportedStatementError(`Closing balance mismatch: statement ${closing}, computed ${balance}`);
  return opening;
}
