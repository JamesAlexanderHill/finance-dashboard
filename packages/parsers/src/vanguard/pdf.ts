import {
  instrumentCommodity,
  UnsupportedStatementError,
  type ParsedAccountSection,
  type ParsedInstrument,
  type ParsedPrice,
  type ParsedRow,
  type ParsedStatement,
} from '@finance/domain';
import { add, eq, isoDate, isZero, sub, type DecimalString, type IsoDate } from '@finance/shared';
import type { TextLine } from '../pdf';

export const VANGUARD_PDF_PARSER_ID = 'vanguard-pdf';
export const VANGUARD_PDF_PARSER_VERSION = '1.1.0';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const LONG_MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
const DATE_RE = new RegExp(`^(\\d{1,2})-(${MONTHS.join('|')})-(\\d{2}|\\d{4})$`);
const LONG_DATE_RE = new RegExp(`(\\d{1,2}) (${LONG_MONTHS.join('|')}) (\\d{4})`);
const AMOUNT_RE = /^\$?\d{1,3}(?:,\d{3})*\.\d{2,4}$/;
/** Vanguard Personal Investor ETFs trade on the ASX (distribution lines read e.g. `VAS.XASX.AU`). */
const EXCHANGE = 'XASX';
const CURRENCY = 'AUD';
/** Lines closer than this belong to the same table row (rows are ~20pt apart, wrapped text ~5pt). */
const ROW_GAP = 10;

const parseDate = (text: string): IsoDate | null => {
  const m = text.match(DATE_RE);
  if (!m) return null;
  const year = m[3]!.length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  return isoDate(year, MONTHS.indexOf(m[2]!) + 1, Number(m[1]));
};
const num = (text: string) => text.replace(/[$,]/g, '');
const bpayDate = (ref: string): IsoDate | undefined => {
  const m = ref.match(/^CBA(\d{4})(\d{2})(\d{2})/);
  return m ? isoDate(Number(m[1]), Number(m[2]), Number(m[3])) : undefined;
};

export function detectVanguard(lines: TextLine[]): boolean {
  return lines.some((l) => l.page === 1 && l.text.includes('Vanguard Personal Investor Annual Statement'));
}

/** Groups consecutive lines of one page into table rows by vertical proximity. */
function blocks(lines: TextLine[]): TextLine[][] {
  const out: TextLine[][] = [];
  for (const line of lines) {
    const last = out.at(-1);
    const prev = last?.at(-1);
    if (last && prev && prev.page === line.page && prev.y - line.y <= ROW_GAP) last.push(line);
    else out.push([line]);
  }
  return out;
}

const isFurniture = (l: TextLine) =>
  l.text.startsWith('Account number:') ||
  /^Page \d+ of \d+$/.test(l.text) ||
  l.text.startsWith('Vanguard Investments Australia Ltd') ||
  l.text.startsWith('Past performance');

/** Lines of a table: from each page's header row until `end` matches (header repeats on every page). */
function tableLines(lines: TextLine[], isHeader: (l: TextLine) => boolean, isEnd: (l: TextLine) => boolean) {
  const out: TextLine[] = [];
  let inTable = false;
  let headerPage = 0;
  for (const line of lines) {
    if (isHeader(line)) {
      inTable = true;
      headerPage = line.page;
      continue;
    }
    if (!inTable || isFurniture(line)) continue;
    if (line.page !== headerPage) continue; // A table continues only on pages that repeat its header.
    if (isEnd(line)) {
      out.push(line);
      break;
    }
    out.push(line);
  }
  return out;
}

interface Trade {
  date: IsoDate;
  code: string;
  name: string;
  quantity: DecimalString;
  price: DecimalString;
  value: DecimalString;
}

interface Holding {
  code: string;
  name: string;
  quantity: DecimalString;
  price: DecimalString;
  priceDate: IsoDate;
}

/**
 * Parses a Vanguard Personal Investor annual statement into:
 * - the Vanguard Cash Account (deposits, distributions, trade settlements);
 * - one holding account per ETF, whose rows are buys (quantities) and whose closing balance is the
 *   year-end quantity from the valuation table (the opening quantity is derived from it);
 * - closing prices (valuation table) and trade prices.
 * A buy's cash row and its units row share a provider reference, so they form one investment event.
 * Anything other than buys (sells, brokerage, transfers in or out) is rejected until a fixture exists.
 */
export function parseVanguardPdf(lines: TextLine[]): ParsedStatement {
  if (!detectVanguard(lines)) throw new UnsupportedStatementError('Not a recognised Vanguard statement');
  const page1 = lines.filter((l) => l.page === 1);

  const accountNumber = page1.find((l) => l.text.startsWith('Account number:'))?.items.at(-1)?.text;
  if (!accountNumber || !/^\d+$/.test(accountNumber)) throw new UnsupportedStatementError('Vanguard account number not found');
  const endMatch = page1.find((l) => l.text.startsWith('Period ending'))?.text.match(LONG_DATE_RE);
  const startMatch = page1.find((l) => l.text.startsWith('Portfolio opening value as at'))?.text.match(LONG_DATE_RE);
  if (!endMatch || !startMatch) throw new UnsupportedStatementError('Statement period not found');
  const toIso = (m: RegExpMatchArray) => isoDate(Number(m[3]), LONG_MONTHS.indexOf(m[2]!) + 1, Number(m[1]));
  const periodStart = toIso(startMatch);
  const periodEnd = toIso(endMatch);

  for (const label of [
    'Withdrawals from Vanguard Cash Account',
    'Assets transferred in',
    'Assets transferred out',
    'Direct fees and costs',
  ]) {
    const value = page1.find((l) => l.text.startsWith(label))?.items.at(-1)?.text;
    if (value && !isZero(num(value))) throw new UnsupportedStatementError(`Statements with "${label}" are not supported yet`);
  }

  const holdings = readHoldings(lines);
  const trades = readTrades(lines);
  const cash = readCash(lines, accountNumber);

  // Link each buy's cash row and units row with one provider reference. Pair them by trade date and
  // code (in value order); the cash debit may differ from the trade value by a cent of rounding.
  const cashBuys = new Map<string, ParsedRow[]>();
  for (const row of cash.rows) {
    const buy = row.description.match(/^Buy transaction of ([A-Z0-9]+)$/);
    if (buy) cashBuys.set(`${row.postedOn}:${buy[1]}`, [...(cashBuys.get(`${row.postedOn}:${buy[1]}`) ?? []), row]);
  }
  const tradeRefs = new Map<Trade, string>();
  const tradesByKey = Map.groupBy(trades, (t) => `${t.date}:${t.code}`);
  for (const key of new Set([...cashBuys.keys(), ...tradesByKey.keys()])) {
    const cashRows = [...(cashBuys.get(key) ?? [])].sort((a, b) => Number(a.amount.slice(1)) - Number(b.amount.slice(1)));
    const keyTrades = [...(tradesByKey.get(key) ?? [])].sort((a, b) => Number(a.value) - Number(b.value));
    if (cashRows.length !== keyTrades.length) {
      throw new UnsupportedStatementError(`Cash buys and investment transactions do not match for ${key.replace(':', ' ')}`);
    }
    keyTrades.forEach((trade, i) => {
      const row = cashRows[i]!;
      if (Math.abs(Number(sub(row.amount.slice(1), trade.value))) > 0.01) {
        throw new UnsupportedStatementError(
          `Cash buy ${row.amount} does not match trade value ${trade.value} for ${key.replace(':', ' ')}`,
        );
      }
      const ref = `vanguard:${accountNumber}:buy:${key}${i ? `:${i + 1}` : ''}`;
      row.groupRef = ref;
      tradeRefs.set(trade, ref);
    });
  }

  let rowIndex = cash.rows.length;
  const names = new Map<string, string>();
  for (const h of holdings) names.set(h.code, h.name);
  for (const t of trades) if (!names.has(t.code)) names.set(t.code, t.name);

  const prices: ParsedPrice[] = [];
  const sections: ParsedAccountSection[] = [];
  for (const code of [...names.keys()].sort()) {
    const instrument: ParsedInstrument = { symbol: code, exchange: EXCHANGE, name: names.get(code)!, currency: CURRENCY };
    const rows: ParsedRow[] = trades
      .filter((t) => t.code === code)
      .map((t) => {
        const row: ParsedRow = {
          rowIndex: rowIndex++,
          postedOn: t.date,
          description: `Buy ${t.quantity} ${code} @ ${t.price}`,
          amount: t.quantity,
          groupRef: tradeRefs.get(t)!,
          raw: { ...t },
        };
        prices.push({
          symbol: code,
          exchange: EXCHANGE,
          on: t.date,
          price: t.price,
          currency: CURRENCY,
          priceType: 'trade',
          sourceRow: row.rowIndex,
        });
        return row;
      });
    const holding = holdings.find((h) => h.code === code);
    const closing = holding?.quantity ?? '0';
    const opening = sub(closing, add('0', ...rows.map((r) => r.amount)));
    if (opening.startsWith('-'))
      throw new UnsupportedStatementError(`${code}: trades exceed the closing quantity; sells are not supported yet`);
    if (holding)
      prices.push({
        symbol: code,
        exchange: EXCHANGE,
        on: holding.priceDate,
        price: holding.price,
        currency: CURRENCY,
        priceType: 'daily',
      });
    sections.push({
      identifier: code,
      maskedIdentifier: `${code} · ${EXCHANGE}`,
      name: code,
      accountType: 'investment',
      classification: 'asset',
      commodity: instrumentCommodity(instrument),
      instrument,
      openingBalance: { on: periodStart, balance: opening },
      closingBalance: { on: periodEnd, balance: closing },
      rows,
    });
  }

  return {
    parserId: VANGUARD_PDF_PARSER_ID,
    parserVersion: VANGUARD_PDF_PARSER_VERSION,
    provider: 'vanguard',
    institutionName: 'Vanguard',
    periodStart,
    periodEnd,
    accounts: [
      {
        identifier: 'CASH',
        maskedIdentifier: `Cash •••• ${cash.accountNumber.slice(-4)}`,
        name: 'Vanguard Cash Account',
        accountType: 'investment',
        classification: 'asset',
        commodity: CURRENCY,
        openingBalance: { on: periodStart, balance: cash.opening },
        closingBalance: { on: periodEnd, balance: cash.closing },
        rows: cash.rows,
      },
      ...sections,
    ],
    prices,
    warnings: [],
  };
}

function readCash(lines: TextLine[], accountNumber: string) {
  const start = lines.findIndex((l) => l.text === 'Your Vanguard Cash Account transaction details');
  if (start < 0) throw new UnsupportedStatementError('Cash account transactions not found');
  const cashAccount =
    lines
      .slice(start, start + 6)
      .find((l) => l.text.startsWith('Account number:'))
      ?.items.at(-1)?.text ?? accountNumber;

  const isHeader = (l: TextLine) => l.text.startsWith('Effective date') && l.text.includes('Balance ($)');
  const header = lines.find(isHeader);
  if (!header) throw new UnsupportedStatementError('Cash account table header not found');
  const col = (prefix: string) => header.items.find((i) => i.text.startsWith(prefix))!;
  const [debit, credit, balanceHeader] = [col('Debits'), col('Credits'), col('Balance')];
  const balanceFrom = (credit.right + balanceHeader.x) / 2;

  const table = tableLines(lines, isHeader, (l) => l.text.includes('Closing balance'));
  const rows: ParsedRow[] = [];
  let opening: DecimalString | null = null;
  let closing: DecimalString | null = null;

  for (const block of blocks(table)) {
    const items = block.flatMap((l) => l.items);
    const dateItem = items.find((i) => parseDate(i.text));
    if (!dateItem) continue;
    const postedOn = parseDate(dateItem.text)!;
    let amount: DecimalString | null = null;
    let balance: DecimalString | null = null;
    const words: string[] = [];
    for (const item of items) {
      if (item === dateItem) continue;
      if (!AMOUNT_RE.test(item.text)) {
        words.push(item.text);
        continue;
      }
      const value = num(item.text);
      if (item.x >= balanceFrom) balance = value;
      else amount = Math.abs(item.right - debit.right) < Math.abs(item.right - credit.right) ? `-${value}` : value;
    }
    const description = words.join(' ').replace(/\s+/g, ' ').trim();
    if (description === 'Opening balance') {
      opening = balance;
      continue;
    }
    if (description === 'Closing balance') {
      closing = balance;
      continue;
    }
    if (amount === null) throw new UnsupportedStatementError(`No amount found for cash row on ${postedOn}: ${description}`);

    const bpay = description.match(/^BPAY DEPOSIT (CBA\d+)$/);
    rows.push({
      rowIndex: rows.length,
      postedOn,
      description,
      amount,
      runningBalance: balance ?? undefined,
      providerId: bpay ? `BPAY:${bpay[1]}` : undefined,
      // A CommBank BPAY receipt starts with the payer's posting date (CBAyyyymmdd…).
      counterpartDate: bpay ? bpayDate(bpay[1]!) : undefined,
      // Deposits come from the owner's bank account; they are transfers until matched.
      transferHint: /^(BPAY DEPOSIT|Off-System BSB Direct Entry Deposit)/.test(description),
      raw: { page: block[0]!.page, lines: block.map((l) => l.text) },
    });
  }
  if (opening === null || closing === null) throw new UnsupportedStatementError('Cash account opening or closing balance not found');

  let running = opening;
  for (const row of rows) {
    running = add(running, row.amount);
    if (row.runningBalance !== undefined && !eq(running, row.runningBalance)) {
      throw new UnsupportedStatementError(
        `Cash running balance mismatch on ${row.postedOn}: expected ${row.runningBalance}, computed ${running}`,
      );
    }
  }
  if (!eq(running, closing))
    throw new UnsupportedStatementError(`Cash closing balance mismatch: statement ${closing}, computed ${running}`);
  return { accountNumber: cashAccount, opening, closing, rows };
}

function readTrades(lines: TextLine[]): Trade[] {
  const isHeader = (l: TextLine) => l.text.startsWith('Trade date') && l.text.includes('Quantity');
  const table = tableLines(lines, isHeader, (l) => l.text === 'Notes:');
  const trades: Trade[] = [];
  for (const block of blocks(table)) {
    const data = block.find((l) => parseDate(l.items[0]!.text));
    if (!data) continue;
    const text = block.map((l) => l.text).join(' ');
    const code = text.match(/\(([A-Z0-9]+)\)/)?.[1];
    if (!code) throw new UnsupportedStatementError(`Investment code not found: ${text}`);
    const words = block.flatMap((l) => l.items).filter((i) => i.x >= 300 && i.x < 480 && !AMOUNT_RE.test(i.text));
    if (words[0]?.text.split(' ')[0] !== 'Buy')
      throw new UnsupportedStatementError(`Unsupported investment transaction: ${words.map((w) => w.text).join(' ')}`);
    const numbers = data.items
      .slice(2)
      .filter((i) => AMOUNT_RE.test(i.text))
      .map((i) => num(i.text));
    const currency = data.items.find((i) => /^[A-Z]{3}$/.test(i.text))?.text;
    if (numbers.length !== 4 || currency !== CURRENCY)
      throw new UnsupportedStatementError(`Unexpected investment transaction layout: ${data.text}`);
    const [quantity, price, brokerage, value] = numbers as [string, string, string, string];
    if (!isZero(brokerage)) throw new UnsupportedStatementError('Trades with brokerage are not supported yet');
    const name = block
      .flatMap((l) => l.items)
      .filter((i) => i.x >= 180 && i.x < 300)
      .map((i) => i.text)
      .join(' ')
      .replace(/\s*\([A-Z0-9]+\)$/, '')
      .trim();
    trades.push({ date: parseDate(data.items[0]!.text)!, code, name, quantity, price, value });
  }
  return trades;
}

function readHoldings(lines: TextLine[]): Holding[] {
  const summaryRows = ['Vanguard Cash Account', 'ETFs', 'Income on investments due not yet received', 'Total cash and investment value'];
  // Only cash and ETFs are understood; any other investment type in the summary is rejected.
  const summaryStart = lines.findIndex((l) => l.text.startsWith('Investment type') && l.text.includes('Value ($)'));
  if (summaryStart < 0) throw new UnsupportedStatementError('Portfolio valuation summary not found');
  for (const line of lines.slice(summaryStart + 1)) {
    const label = line.items[0]!.text;
    if (!summaryRows.includes(label)) throw new UnsupportedStatementError(`Unsupported investment type in valuation: ${label}`);
    if (label.startsWith('Income on investments') && !isZero(num(line.items.at(-1)!.text))) {
      throw new UnsupportedStatementError('Statements with income due but not yet received are not supported yet');
    }
    if (label === 'Total cash and investment value') break;
  }

  const isHeader = (l: TextLine) => l.items[0]?.text === 'Code' && l.text.includes('Quantity');
  const table = tableLines(lines, isHeader, (l) => l.text.startsWith('Total ETFs'));
  const holdings: Holding[] = [];
  for (const block of blocks(table)) {
    const data = block.find((l) => /^[A-Z0-9]{2,6}$/.test(l.items[0]!.text) && l.items.some((i) => parseDate(i.text)));
    if (!data) continue;
    const code = data.items[0]!.text;
    const numbers = data.items.filter((i) => AMOUNT_RE.test(i.text)).map((i) => num(i.text));
    const priceDate = data.items.map((i) => parseDate(i.text)).find(Boolean);
    if (numbers.length !== 3 || !priceDate) throw new UnsupportedStatementError(`Unexpected valuation row: ${data.text}`);
    const [quantity, price] = numbers as [string, string, string];
    const name = block
      .flatMap((l) => l.items)
      .filter((i) => i.x >= 100 && i.x < 300)
      .map((i) => i.text)
      .join(' ')
      .trim();
    holdings.push({ code, name, quantity, price, priceDate });
  }
  return holdings;
}
