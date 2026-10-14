import {
  UnsupportedStatementError,
  type ParsedAccountSection,
  type ParsedRow,
  type ParsedStatement,
} from '@finance/domain';
import { add, eq, isoDate, type DecimalString, type IsoDate } from '@finance/shared';
import type { TextItem, TextLine } from '../pdf';

export const COMMBANK_PDF_PARSER_ID = 'commbank-pdf';
export const COMMBANK_PDF_PARSER_VERSION = '1.1.0';

/**
 * Home-loan rows that move principal rather than earn or spend: repayments arrive from another
 * account, and the drawdown pays for an asset. They are hinted as transfers so they stay out of
 * income and expense until matched. Interest and fees are not hinted.
 */
const LOAN_TRANSFER_RE = /^(Repayment\/Payment|Money we lent you)\b/;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_RE = MONTHS.join('|');
const FULL_DATE_RE = new RegExp(`(\\d{1,2}) (${MONTH_RE}) (\\d{4})`, 'g');
const ROW_DATE_RE = new RegExp(`^(\\d{1,2}) (${MONTH_RE})(?: (\\d{4}))?(?:\\s+(.*))?$`);
const AMOUNT_RE = /^-?\$?(\d{1,3}(?:,\d{3})*\.\d{2})(?:\s*(CR|DR))?$/;
/** Text left of this x is page furniture (barcodes, print codes). */
const LEFT_MARGIN = 45;

type Layout = 'deposit' | 'home-loan';

interface Columns {
  dateX: number;
  debitRight: number;
  creditRight: number;
  /** Amounts starting right of this are running balances. */
  balanceFrom: number;
}

interface PendingRow {
  postedOn: IsoDate;
  page: number;
  descriptionParts: string[];
  amount?: DecimalString;
  balance?: DecimalString;
  lines: string[];
}

/** Detects whether text lines look like a Commbank deposit or home-loan statement. */
export function detectCommbankLayout(lines: TextLine[]): Layout | null {
  const page = statementPage(lines);
  if (!page) return null;
  const all = lines.filter((l) => l.page === page).map((l) => l.text).join('\n');
  if (/Home Loan (Summary|Transactions)/.test(lines.map((l) => l.text).join('\n')) && /Statement period/.test(all)) {
    return 'home-loan';
  }
  if (/Account Number/.test(all) && /Period/.test(all) && /13 2221/.test(all)) return 'deposit';
  return null;
}

export function parseCommbankPdf(lines: TextLine[]): ParsedStatement {
  const layout = detectCommbankLayout(lines);
  if (!layout) throw new UnsupportedStatementError('Not a recognised Commbank statement layout');

  const content = lines
    .map((l) => ({ ...l, items: l.items.filter((i) => i.x >= LEFT_MARGIN) }))
    .filter((l) => l.items.length > 0)
    .map((l) => ({ ...l, text: l.items.map((i) => i.text).join(' ') }));

  const { start: periodStart, end: periodEnd } = readPeriod(content);
  const section = layout === 'home-loan' ? readLoanAccount(content) : readDepositAccount(content);
  const warnings: string[] = [];
  const { rows, opening, closing } = readTransactions(content, periodStart, periodEnd, section.liability);
  if (layout === 'home-loan') for (const row of rows) if (LOAN_TRANSFER_RE.test(row.description)) row.transferHint = true;

  if (!opening) throw new UnsupportedStatementError('Opening balance row not found');
  if (!closing) throw new UnsupportedStatementError('Closing balance row not found');
  verifyRunningBalances(rows, opening.balance, closing.balance);

  const account: ParsedAccountSection = {
    identifier: section.identifier,
    maskedIdentifier: `•••• ${section.identifier.slice(-4)}`,
    name: section.name,
    accountType: layout === 'home-loan' ? 'loan' : 'bank',
    classification: layout === 'home-loan' ? 'liability' : 'asset',
    commodity: 'AUD',
    openingBalance: opening,
    closingBalance: closing,
    rows,
  };

  return {
    parserId: COMMBANK_PDF_PARSER_ID,
    parserVersion: COMMBANK_PDF_PARSER_VERSION,
    provider: 'commbank',
    institutionName: 'Commbank',
    periodStart,
    periodEnd,
    accounts: [account],
    warnings,
  };
}

// ---------------------------------------------------------------- header fields

/** Home-loan PDFs may open with letters; the statement proper starts at the "Your Statement" page. */
function statementPage(lines: TextLine[]): number | undefined {
  return lines.find((l) => /Your Statement/.test(l.text))?.page;
}

function readPeriod(lines: TextLine[]): { start: IsoDate; end: IsoDate } {
  const page = statementPage(lines);
  const line = lines.find((l) => l.page === page && /\b[Pp]eriod\b/.test(l.text) && FULL_DATE_RE.test(l.text));
  FULL_DATE_RE.lastIndex = 0;
  const dates = line ? [...line.text.matchAll(FULL_DATE_RE)] : [];
  if (dates.length < 2) throw new UnsupportedStatementError('Statement period not found');
  const toIso = (m: RegExpMatchArray) => isoDate(Number(m[3]), MONTHS.indexOf(m[2]!) + 1, Number(m[1]));
  return { start: toIso(dates[0]!), end: toIso(dates[1]!) };
}

function readDepositAccount(lines: TextLine[]) {
  const page = statementPage(lines);
  const numberLine = lines.find((l) => l.page === page && l.text.startsWith('Account Number'));
  const identifier = numberLine?.text.replace('Account Number', '').replace(/\s+/g, '');
  if (!identifier || !/^\d{6,}$/.test(identifier)) throw new UnsupportedStatementError('Account number not found');

  // The product name ("Smart Access", "Everyday Offset") is the first short plain line after the enquiries line.
  const page1 = lines.filter((l) => l.page === page);
  const enquiries = page1.findIndex((l) => l.text.startsWith('Enquiries'));
  const nameLine = page1
    .slice(enquiries + 1)
    .find((l) => l.items.length === 1 && l.text.length < 40 && !/\d/.test(l.text) && /^[A-Z]/.test(l.text));
  return { identifier, name: nameLine?.text ?? 'Commbank account', liability: false };
}

function readLoanAccount(lines: TextLine[]) {
  const page = statementPage(lines);
  const numberLine = lines.find((l) => l.page === page && /^Account number\b/.test(l.text));
  const identifier = numberLine?.text.replace(/^Account number/, '').replace(/\s+/g, '');
  if (!identifier || !/^\d{6,}$/.test(identifier)) throw new UnsupportedStatementError('Loan account number not found');
  const title = lines.map((l) => l.text.match(/^(.*Home Loan) (Transactions|Summary)\b/)?.[1]).find(Boolean);
  return { identifier, name: title ?? 'Home Loan', liability: true };
}

// ---------------------------------------------------------------- transaction table

function readColumns(line: TextLine): Columns | null {
  const find = (re: RegExp) => line.items.find((i) => re.test(i.text));
  const debit = find(/^Debits?$/);
  const credit = find(/^Credits?$/);
  const balance = find(/^Balance$/);
  if (!debit || !credit || !balance) return null;
  const date = find(/^Date\b/);
  return {
    dateX: date?.x ?? line.items[0]!.x,
    debitRight: debit.right,
    creditRight: credit.right,
    balanceFrom: (credit.right + balance.x) / 2,
  };
}

function readTransactions(lines: TextLine[], periodStart: IsoDate, periodEnd: IsoDate, liability: boolean) {
  const rows: ParsedRow[] = [];
  let opening: { on: IsoDate; balance: DecimalString } | undefined;
  let closing: { on: IsoDate; balance: DecimalString } | undefined;
  let columns: Columns | null = null;
  let columnsPage = 0;
  let pending: PendingRow | null = null;

  const finish = () => {
    if (pending?.amount === undefined) {
      pending = null; // Notes (e.g. repayment-change notices) carry a date but no amount.
      return;
    }
    rows.push({
      rowIndex: rows.length,
      postedOn: pending.postedOn,
      description: pending.descriptionParts.join(' ').replace(/\s+/g, ' ').trim(),
      amount: pending.amount,
      runningBalance: pending.balance,
      raw: { page: pending.page, lines: pending.lines },
    });
    pending = null;
  };

  for (const line of lines) {
    if (closing) break;
    const header = readColumns(line);
    if (header) {
      columns = header;
      columnsPage = line.page;
      continue;
    }
    // The "Date" label sometimes sits on its own line just below the header.
    if (!columns || line.page !== columnsPage || line.text === 'Date') continue;
    if (/^Opening balance\b.*Total debits/.test(line.text)) break;

    const first = line.items[0]!;
    const dateMatch = Math.abs(first.x - columns.dateX) <= 8 ? matchRowDate(line.items) : null;
    const { amount, balance, textItems } = classifyItems(line.items, columns, dateMatch?.consumed ?? 0);
    const text = textItems.join(' ').trim();

    if (dateMatch) {
      finish();
      const postedOn = resolveDate(dateMatch, periodStart, periodEnd);
      const signedBalance = balance && liabilitySign(balance);
      if (/^OPENING BALANCE$/i.test(text)) {
        opening = { on: postedOn, balance: signedBalance ?? '0' };
        continue;
      }
      if (/^CLOSING BALANCE$/i.test(text)) {
        closing = { on: postedOn, balance: signedBalance ?? '0' };
        continue;
      }
      pending = { postedOn, page: line.page, descriptionParts: [], lines: [] };
    }
    if (!pending || pending.amount !== undefined) continue;

    pending.lines.push(line.text);
    if (text) pending.descriptionParts.push(text);
    if (amount) {
      pending.amount = amount;
      pending.balance = balance && liabilitySign(balance);
    }
  }
  finish();

  function liabilitySign(b: { value: DecimalString; side?: 'CR' | 'DR' }): DecimalString {
    // Balances are signed from the owner's view: DR (owed) is negative.
    const side = b.side ?? (liability ? 'DR' : 'CR');
    return side === 'DR' && b.value !== '0' ? `-${b.value}` : b.value;
  }

  return { rows, opening, closing };
}

interface DateMatch {
  day: number;
  month: number;
  year?: number;
  /** How many leading items the date (and any glued description) used. */
  consumed: number;
  rest?: string;
}

function matchRowDate(items: TextItem[]): DateMatch | null {
  const m = items[0]!.text.match(ROW_DATE_RE);
  if (!m) return null;
  return {
    day: Number(m[1]),
    month: MONTHS.indexOf(m[2]!) + 1,
    year: m[3] ? Number(m[3]) : undefined,
    consumed: 1,
    rest: m[4],
  };
}

function resolveDate(d: DateMatch, periodStart: IsoDate, periodEnd: IsoDate): IsoDate {
  if (d.year) return isoDate(d.year, d.month, d.day);
  const startYear = Number(periodStart.slice(0, 4));
  const endYear = Number(periodEnd.slice(0, 4));
  for (let y = startYear; y <= endYear; y++) {
    const candidate = isoDate(y, d.month, d.day);
    if (candidate >= periodStart && candidate <= periodEnd) return candidate;
  }
  throw new UnsupportedStatementError(`Row date ${d.day}/${d.month} falls outside statement period`);
}

function classifyItems(items: TextItem[], columns: Columns, skip: number) {
  const textItems: string[] = [];
  let amount: DecimalString | undefined;
  let balance: { value: DecimalString; side?: 'CR' | 'DR' } | undefined;

  items.forEach((item, index) => {
    if (index < skip) {
      const rest = item.text.match(ROW_DATE_RE)?.[4];
      if (rest) textItems.push(rest);
      return;
    }
    const text = item.text;
    if (text === '$' || text === '(' || text === ')') return;
    if (text === 'CR' || text === 'DR') {
      if (balance) balance.side = text;
      return;
    }
    if (text === 'Nil' && item.x >= columns.balanceFrom) {
      balance = { value: '0' };
      return;
    }
    const m = text.match(AMOUNT_RE);
    if (!m) {
      textItems.push(text);
      return;
    }
    const value = m[1]!.replace(/,/g, '');
    if (item.x >= columns.balanceFrom) {
      balance = { value, side: m[2] as 'CR' | 'DR' | undefined };
      return;
    }
    const isDebit = Math.abs(item.right - columns.debitRight) < Math.abs(item.right - columns.creditRight);
    amount = isDebit ? `-${value}` : value;
  });

  return { amount, balance, textItems };
}

function verifyRunningBalances(rows: ParsedRow[], opening: DecimalString, closing: DecimalString) {
  let balance = opening;
  for (const row of rows) {
    balance = add(balance, row.amount);
    if (row.runningBalance !== undefined && !eq(balance, row.runningBalance)) {
      throw new UnsupportedStatementError(
        `Running balance mismatch on ${row.postedOn} "${row.description}": expected ${row.runningBalance}, computed ${balance}`,
      );
    }
  }
  if (!eq(balance, closing)) {
    throw new UnsupportedStatementError(`Closing balance mismatch: statement ${closing}, computed ${balance}`);
  }
}
