import {
  FX_EXCHANGE,
  REPORTING_CURRENCY,
  UnsupportedStatementError,
  type ParsedAccountSection,
  type ParsedPrice,
  type ParsedRow,
  type ParsedStatement,
} from '@finance/domain';
import { add, div, eq, isoDate, isZero, neg, sub, toFixed2, type DecimalString, type IsoDate } from '@finance/shared';
import type { TextLine } from '../pdf';

export const AMEX_PDF_PARSER_ID = 'amex-pdf';
export const AMEX_PDF_PARSER_VERSION = '1.0.0';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MONTH_RE = MONTHS.join('|');
const ROW_DATE_RE = new RegExp(`^(${MONTH_RE}) (\\d{1,2})$`);
const AMOUNT_RE = /^\d{1,3}(?:,\d{3})*\.\d{2}$/;
/** Amex prints card currencies by name; a name not listed here keeps its row but records no rate. */
const CURRENCY_NAMES: Record<string, string> = {
  'UNITED STATES DOLLAR': 'USD',
  'NEW ZEALAND DOLLAR': 'NZD',
  EURO: 'EUR',
  'POUND STERLING': 'GBP',
  'UK POUND STERLING': 'GBP',
  'JAPANESE YEN': 'JPY',
  'SINGAPORE DOLLAR': 'SGD',
  'HONG KONG DOLLAR': 'HKD',
  'CANADIAN DOLLAR': 'CAD',
  'SWISS FRANC': 'CHF',
  'INDONESIAN RUPIAH': 'IDR',
  'MALAYSIAN RINGGIT': 'MYR',
  'THAI BAHT': 'THB',
};
/** Statements list charges received in the period, so a purchase can be dated up to a cycle before it starts. */
const MAX_DAYS_BEFORE_PERIOD = 62;

interface Columns {
  detailsX: number;
  foreignX: number;
  foreignRight: number;
  amountRight: number;
}

interface PendingRow {
  postedOn: IsoDate;
  page: number;
  description: string;
  amount: DecimalString;
  credit: boolean;
  section: string;
  card?: string;
  foreign?: { amount: DecimalString; currencyName?: string; commission?: DecimalString };
  lines: string[];
}

export function detectAmex(lines: TextLine[]): boolean {
  const page1 = lines.filter((l) => l.page === 1).map((l) => l.text);
  return (
    page1.some((t) => t.includes('americanexpress.com.au')) &&
    page1.some((t) => t.includes('Statement of Account')) &&
    page1.some((t) => t.includes('Membership Number'))
  );
}

/**
 * Parses an American Express (Australia) card statement: one AUD liability account holding every
 * card member's rows. Payments are hinted as transfers; a foreign purchase is split into the spend
 * and its conversion commission (a fee row in the same event) and records the implied FX rate.
 * Section totals and the account summary must reconcile, otherwise the statement is unsupported.
 */
export function parseAmexPdf(lines: TextLine[]): ParsedStatement {
  if (!detectAmex(lines)) throw new UnsupportedStatementError('Not a recognised American Express statement');
  const page1 = lines.filter((l) => l.page === 1);
  const { periodStart, periodEnd } = readPeriod(page1);
  const identifier = readMembershipNumber(page1);
  const summary = readSummary(page1);
  const pending = readRows(lines, periodStart, periodEnd);

  const rows: ParsedRow[] = [];
  const prices: ParsedPrice[] = [];
  const warnings: string[] = [];
  for (const p of pending) {
    const sign = (v: DecimalString) => (p.credit ? v : debit(v));
    const raw = { page: p.page, section: p.section, card: p.card, foreign: p.foreign, lines: p.lines };
    const base = { postedOn: p.postedOn, description: p.description, raw };
    if (!p.foreign) {
      rows.push({ ...base, rowIndex: rows.length, amount: sign(p.amount), ...(p.section === 'payments' && { transferHint: true }) });
      continue;
    }
    const commission = p.foreign.commission ?? '0';
    const spend = toFixed2(sub(p.amount, commission));
    const groupRef = `amex:${identifier}:${periodEnd}:${rows.length}`;
    const principal = rows.length;
    rows.push({ ...base, rowIndex: principal, amount: sign(spend), groupRef });
    if (!isZero(commission)) {
      rows.push({
        ...base,
        rowIndex: rows.length,
        description: `${p.description} conversion commission`,
        amount: sign(commission),
        groupRef,
        role: 'fee',
      });
    }
    const currency = p.foreign.currencyName && CURRENCY_NAMES[p.foreign.currencyName];
    if (currency) {
      prices.push({
        symbol: currency,
        exchange: FX_EXCHANGE,
        on: p.postedOn,
        price: div(spend, p.foreign.amount),
        currency: REPORTING_CURRENCY,
        priceType: 'trade',
        sourceRow: principal,
      });
    } else {
      warnings.push(`No rate recorded for ${p.postedOn} "${p.description}": unknown currency ${p.foreign.currencyName ?? '(missing)'}`);
    }
  }

  // The summary is in the card's terms (owed is positive); the owner's view is the opposite.
  const credits = add('0', ...rows.filter((r) => !r.amount.startsWith('-')).map((r) => r.amount));
  const debits = neg(add('0', ...rows.filter((r) => r.amount.startsWith('-')).map((r) => r.amount)));
  if (!eq(credits, summary.credits))
    throw new UnsupportedStatementError(`New credits mismatch: statement ${summary.credits}, rows ${credits}`);
  if (!eq(debits, summary.debits)) throw new UnsupportedStatementError(`New debits mismatch: statement ${summary.debits}, rows ${debits}`);
  if (!eq(add(summary.opening, summary.debits, neg(summary.credits)), summary.closing)) {
    throw new UnsupportedStatementError('Account summary does not add up');
  }

  // Rows are dated by purchase, so some precede the period; the opening balance applies before all of them.
  const earliest = rows.map((r) => r.postedOn).sort()[0];
  const openingOn = earliest && earliest < periodStart ? earliest : periodStart;
  const account: ParsedAccountSection = {
    identifier,
    maskedIdentifier: `•••• ${identifier.replace(/\D/g, '').slice(-5)}`,
    name: readCardName(page1),
    accountType: 'credit_card',
    classification: 'liability',
    commodity: 'AUD',
    openingBalance: { on: openingOn, balance: debit(summary.opening) },
    closingBalance: { on: periodEnd, balance: debit(summary.closing) },
    rows,
  };
  return {
    parserId: AMEX_PDF_PARSER_ID,
    parserVersion: AMEX_PDF_PARSER_VERSION,
    provider: 'amex',
    institutionName: 'American Express',
    periodStart,
    periodEnd,
    accounts: [account],
    prices,
    warnings,
  };
}

// ---------------------------------------------------------------- header fields

function readPeriod(page1: TextLine[]): { periodStart: IsoDate; periodEnd: IsoDate } {
  const re = new RegExp(`From (${MONTH_RE}) (\\d{1,2}) to (${MONTH_RE}) (\\d{1,2}), (\\d{4})`);
  const m = page1.map((l) => l.text.match(re)).find(Boolean);
  if (!m) throw new UnsupportedStatementError('Statement period not found');
  const [startMonth, endMonth, endYear] = [MONTHS.indexOf(m[1]!) + 1, MONTHS.indexOf(m[3]!) + 1, Number(m[5])];
  return {
    periodStart: isoDate(startMonth > endMonth ? endYear - 1 : endYear, startMonth, Number(m[2])),
    periodEnd: isoDate(endYear, endMonth, Number(m[4])),
  };
}

function readMembershipNumber(page1: TextLine[]): string {
  const label = page1.find((l) => l.items.some((i) => i.text === 'Membership Number'));
  const next = label && page1[page1.indexOf(label) + 1];
  const number = next?.items.find((i) => /^[X\d]{4}-[X\d]{6}-\d{5}$/i.test(i.text))?.text;
  if (!number) throw new UnsupportedStatementError('Membership number not found');
  return number.toUpperCase();
}

function readCardName(page1: TextLine[]): string {
  return (
    page1.flatMap((l) => l.items).find((i) => /American Express .*Card$/.test(i.text) && !/^American Express Credit/.test(i.text))?.text ??
    'American Express Card'
  );
}

function readSummary(page1: TextLine[]) {
  const header = page1.findIndex((l) => l.text.includes('OPENING BALANCE') && l.text.includes('CLOSING BALANCE'));
  const line = header >= 0 ? page1[header + 1] : undefined;
  if (line?.items.some((i) => i.text === 'CR'))
    throw new UnsupportedStatementError('Statements with a balance in credit are not supported yet');
  const amounts = (line?.items ?? []).filter((i) => AMOUNT_RE.test(i.text)).map((i) => plain(i.text));
  if (amounts.length < 4) throw new UnsupportedStatementError('Account summary not found');
  const [opening, credits, debits, closing] = amounts as [string, string, string, string];
  return { opening, credits, debits, closing };
}

// ---------------------------------------------------------------- transaction details

function readColumns(line: TextLine): Columns | null {
  const find = (text: string) => line.items.find((i) => i.text === text);
  const [details, foreign, amount] = [find('TRANSACTION DETAILS'), find('FOREIGN SPEND'), find('AMOUNT ($)')];
  if (!details || !foreign || !amount || !find('TRANSACTION DATE')) return null;
  return { detailsX: details.x, foreignX: foreign.x, foreignRight: foreign.right, amountRight: amount.right };
}

/** Sections whose rows are understood; any other heading (e.g. interest) is rejected until a statement shows one. */
const SECTIONS = ['payments', 'purchases', 'charges'];
const PAGE_FURNITURE = /^(TRANSACTION DETAILS|Statement of Account|Prepared for)$|American Express/;

/** A section heading: a lone label left of the details column. */
function sectionHeading(line: TextLine, columns: Columns): string | null {
  if (line.items.length !== 1 || line.items[0]!.x >= columns.detailsX || PAGE_FURNITURE.test(line.text)) return null;
  if (line.text === 'New Payments') return 'payments';
  if (line.text.startsWith('New Standard Transactions for')) return 'purchases';
  if (line.text === 'Account Charges') return 'charges';
  if (/^Card Number /.test(line.text) || !/^[A-Z][A-Za-z ]+$/.test(line.text)) return null;
  return line.text;
}

/** A statement amount as owed by the owner (negative), keeping its printed precision. */
const debit = (v: DecimalString) => (isZero(v) ? v : `-${v}`);
const near = (a: number, b: number) => Math.abs(a - b) <= 6;
const plain = (text: string) => text.replace(/,/g, '');

function readRows(lines: TextLine[], periodStart: IsoDate, periodEnd: IsoDate): PendingRow[] {
  const rows: PendingRow[] = [];
  let columns: Columns | null = null;
  let section: string | null = null;
  let card: string | undefined;
  /** Rows since the last section heading, checked against the section's printed total. */
  let sectionRows: PendingRow[] = [];
  /** What a following "CR" marks as a credit. */
  let last: { credit: boolean } | null = null;
  let total: { label: string; amount: DecimalString; credit: boolean } | null = null;

  const checkTotal = () => {
    if (!total) return;
    const signed = (v: DecimalString, credit: boolean) => (credit ? neg(v) : v);
    const computed = add('0', ...sectionRows.map((r) => signed(r.amount, r.credit)));
    if (!eq(computed, signed(total.amount, total.credit))) {
      throw new UnsupportedStatementError(
        `${total.label} mismatch: statement ${total.amount}${total.credit ? ' CR' : ''}, rows ${computed}`,
      );
    }
    total = null;
    sectionRows = [];
  };

  for (const line of lines) {
    const header = readColumns(line);
    if (header) {
      columns = header;
      continue;
    }
    if (!columns) continue;
    if (/^Summary of .*Points|^Card Member Offers/.test(line.text)) break;
    const first = line.items[0]!;

    if (line.text === 'CR') {
      if (!last) throw new UnsupportedStatementError(`Unexpected CR on page ${line.page}`);
      last.credit = true;
      continue;
    }
    const totalMatch = line.text.match(/^(Total .+?) ([\d,]+\.\d{2})$/);
    if (totalMatch) {
      checkTotal();
      total = { label: totalMatch[1]!, amount: plain(totalMatch[2]!), credit: false };
      last = total;
      continue;
    }
    checkTotal();

    const dateMatch = first.text.match(ROW_DATE_RE);
    if (!dateMatch) {
      const pendingForeign = rows.at(-1)?.foreign;
      const heading = sectionHeading(line, columns);
      if (heading) {
        section = heading;
        sectionRows = [];
      } else if (/^Card Number /.test(line.text)) card = line.text.replace(/^Card Number /, '').toUpperCase();
      else if (pendingForeign && near(first.right, columns.foreignRight) && /^[A-Z ]+$/.test(line.text)) {
        pendingForeign.currencyName = line.text;
        rows.at(-1)!.lines.push(line.text);
      } else if (pendingForeign && /includes conversion commission of AUD/.test(line.text)) {
        const commission = line.items.at(-1)!.text.match(/^(\d*)\.(\d{2})$/);
        if (!commission) throw new UnsupportedStatementError(`Unreadable conversion commission on page ${line.page}`);
        pendingForeign.commission = `${commission[1] || '0'}.${commission[2]}`;
        rows.at(-1)!.lines.push(line.text);
      }
      continue;
    }

    if (!section || !SECTIONS.includes(section)) {
      throw new UnsupportedStatementError(`Unsupported transaction section "${section ?? '(none)'}" on page ${line.page}`);
    }
    const amount = line.items.find((i) => near(i.right, columns!.amountRight) && AMOUNT_RE.test(i.text));
    if (!amount) throw new UnsupportedStatementError(`No amount for "${line.text}" on page ${line.page}`);
    const foreign = line.items.find((i) => i !== amount && near(i.right, columns!.foreignRight) && AMOUNT_RE.test(i.text));
    const details = line.items.filter((i) => i !== first && i !== amount && i !== foreign).map((i) => i.text);
    const row: PendingRow = {
      postedOn: rowDate(MONTHS.indexOf(dateMatch[1]!) + 1, Number(dateMatch[2]), periodStart, periodEnd),
      page: line.page,
      description: details.join(' ').replace(/\s+/g, ' ').trim(),
      amount: plain(amount.text),
      credit: false,
      section,
      card,
      foreign: foreign ? { amount: plain(foreign.text) } : undefined,
      lines: [line.text],
    };
    rows.push(row);
    sectionRows.push(row);
    last = row;
  }
  checkTotal();
  return rows;
}

function rowDate(month: number, day: number, periodStart: IsoDate, periodEnd: IsoDate): IsoDate {
  const endYear = Number(periodEnd.slice(0, 4));
  let date = isoDate(endYear, month, day);
  if (date > periodEnd) date = isoDate(endYear - 1, month, day);
  const earliest = new Date(Date.parse(`${periodStart}T00:00:00Z`) - MAX_DAYS_BEFORE_PERIOD * 86_400_000).toISOString().slice(0, 10);
  if (date < earliest) throw new UnsupportedStatementError(`Row date ${date} falls too far before the statement period`);
  return date;
}
