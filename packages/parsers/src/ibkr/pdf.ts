import {
  FX_EXCHANGE,
  instrumentCommodity,
  REPORTING_CURRENCY,
  UnsupportedStatementError,
  type ParsedAccountSection,
  type ParsedInstrument,
  type ParsedPrice,
  type ParsedRow,
  type ParsedStatement,
} from '@finance/domain';
import { add, div, eq, isoDate, isZero, type DecimalString, type IsoDate } from '@finance/shared';
import type { TextItem, TextLine } from '../pdf';

export const IBKR_PDF_PARSER_ID = 'ibkr-pdf';
export const IBKR_PDF_PARSER_VERSION = '1.1.0';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const PERIOD_RE = new RegExp(`(${MONTHS.join('|')}) (\\d{1,2}), (\\d{4}) - (${MONTHS.join('|')}) (\\d{1,2}), (\\d{4})`);
const NUMBER_RE = /^-?\d{1,3}(?:,\d{3})*(?:\.\d+)?$|^-?\d+(?:\.\d+)?$/;
const CURRENCY_RE = /^[A-Z]{3}$/;
/** Lines closer than this belong to one table row (IBKR prints the trade date and time above and below it). */
const ROW_GAP = 6;

const SECTIONS = [
  'Account Information',
  'Net Asset Value',
  'Mark-to-Market Performance Summary',
  'Realized & Unrealized Performance Summary',
  'Cash Report',
  'Open Positions',
  'Trades',
  'Deposits & Withdrawals',
  'Financial Instrument Information',
  'Codes',
  'Notes/Legal Notes',
];

/** Cash Report lines this parser understands; anything else (dividends, interest, fees…) is unsupported. */
const CASH_LINES = [
  'Starting Cash',
  'Commissions',
  'Deposits',
  'Trades (Sales)',
  'Trades (Purchase)',
  'Cash FX Translation Gain/Loss',
  'Ending Cash',
  'Ending Settled Cash',
];

/** IBKR listing exchange → ISO 10383 market identifier. */
const EXCHANGES: Record<string, string> = { NASDAQ: 'XNAS', NYSE: 'XNYS', ARCA: 'ARCX', ASX: 'XASX' };

const num = (text: string) => text.replace(/,/g, '');
const round2 = (d: DecimalString) => Number(d).toFixed(2);

export function detectIbkr(lines: TextLine[]): boolean {
  const page1 = lines.filter((l) => l.page === 1).map((l) => l.text);
  return page1.includes('Activity Statement') && page1.some((t) => t.startsWith('Interactive Brokers'));
}

const isFurniture = (l: TextLine) =>
  l.text.startsWith('Activity Statement - ') || l.text.startsWith('Generated:') || /^Page: \d+$/.test(l.text);

/** Lines of a named section (continuing across pages), excluding page furniture. */
function section(lines: TextLine[], name: string): TextLine[] {
  const out: TextLine[] = [];
  let inside = false;
  for (const line of lines) {
    if (SECTIONS.includes(line.text)) {
      inside = line.text === name;
      continue;
    }
    if (inside && !isFurniture(line)) out.push(line);
  }
  return out;
}

/** Groups consecutive lines into table rows by vertical proximity. */
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

/**
 * Reads a row's cells by column. In most tables numbers align right under their header and text
 * aligns left; `left` is for tables where everything aligns left (financial instrument information).
 */
function cells(header: TextLine, row: TextItem[], align: 'auto' | 'left' = 'auto'): Record<string, string> {
  const out: Record<string, string> = {};
  for (const item of row) {
    const byRight = align === 'auto' && (NUMBER_RE.test(item.text) || item.text === '--');
    const distance = (h: TextItem) => (byRight ? Math.abs(h.right - item.right) : Math.abs(h.x - item.x));
    const best = header.items.reduce<TextItem | undefined>((b, h) => (!b || distance(h) < distance(b) ? h : b), undefined);
    if (best) out[best.text] = out[best.text] ? `${out[best.text]} ${item.text}` : item.text;
  }
  return out;
}

const isHeader = (l: TextLine) => l.items[0]?.text === 'Symbol' || l.items[0]?.text === 'Date';

interface Trade {
  kind: 'stock' | 'forex';
  symbol: string;
  currency: string;
  date: IsoDate;
  time: string;
  quantity: DecimalString;
  price: DecimalString;
  proceeds: DecimalString;
  commission: DecimalString;
}

/**
 * Parses an IBKR activity statement (PDF, AUD base currency). Produces one cash account per
 * currency, one holding account per stock, deposits (hinted as transfers), stock buys (cash, units
 * and commission share a provider reference), forex conversions (both currencies plus any
 * commission share one), closing and trade prices. Every currency's cash and every position must
 * reconcile with the statement. Sells, withdrawals, dividends, interest, fees and any other
 * cash-report line are rejected until a fixture shows them.
 */
export function parseIbkrPdf(lines: TextLine[]): ParsedStatement {
  if (!detectIbkr(lines)) throw new UnsupportedStatementError('Not a recognised IBKR activity statement');

  const info = section(lines, 'Account Information');
  const field = (label: string) => info.find((l) => l.items[0]?.text === label)?.items.at(-1)?.text;
  const accountId = field('Account');
  if (!accountId) throw new UnsupportedStatementError('IBKR account number not found');
  if (field('Base Currency') !== 'AUD') throw new UnsupportedStatementError('Only AUD base-currency IBKR accounts are supported');

  const period = lines.find((l) => l.page === 1 && PERIOD_RE.test(l.text))?.text.match(PERIOD_RE);
  if (!period) throw new UnsupportedStatementError('Statement period not found');
  const periodStart = isoDate(Number(period[3]), MONTHS.indexOf(period[1]!) + 1, Number(period[2]));
  const periodEnd = isoDate(Number(period[6]), MONTHS.indexOf(period[4]!) + 1, Number(period[5]));

  const { report: cash, perCurrency } = readCashReport(section(lines, 'Cash Report'), 'AUD');
  const deposits = readDeposits(section(lines, 'Deposits & Withdrawals'));
  const trades = readTrades(section(lines, 'Trades'));
  if (!perCurrency && (deposits.length || trades.length)) throw new UnsupportedStatementError('Cash report has no per-currency breakdown');
  const positions = readPositions(section(lines, 'Open Positions'));
  const markToMarket = section(lines, 'Mark-to-Market Performance Summary');
  const priorQuantities = readPriorQuantities(markToMarket);
  const instruments = readInstruments(section(lines, 'Financial Instrument Information'));
  // An instrument trades in the currency its trades and positions are listed under.
  for (const [symbol, i] of instruments) {
    const listed = trades.find((t) => t.kind === 'stock' && t.symbol === symbol)?.currency ?? positions.get(symbol)?.currency;
    if (listed) instruments.set(symbol, { ...i, currency: listed });
  }

  let rowIndex = 0;
  const cashRows = new Map<string, ParsedRow[]>([...cash.keys()].map((c) => [c, []]));
  const unitRows = new Map<string, ParsedRow[]>();
  const prices: ParsedPrice[] = readFxMarks(markToMarket, periodEnd);
  const pushCash = (currency: string, row: Omit<ParsedRow, 'rowIndex'>) => {
    const rows = cashRows.get(currency);
    if (!rows) throw new UnsupportedStatementError(`No ${currency} cash report for a ${currency} transaction`);
    rows.push({ ...row, rowIndex: rowIndex++ });
  };

  for (const d of deposits) {
    pushCash(d.currency, { postedOn: d.date, description: d.description, amount: d.amount, transferHint: true, raw: { ...d } });
  }

  for (const t of trades) {
    const stamp = `${t.date} ${t.time}`;
    if (t.kind === 'stock') {
      const instrument = instruments.get(t.symbol);
      if (!instrument) throw new UnsupportedStatementError(`No instrument information for ${t.symbol}`);
      const ref = `ibkr:${accountId}:trade:${stamp}:${t.symbol}`;
      pushCash(t.currency, {
        postedOn: t.date,
        description: `Buy ${t.quantity} ${t.symbol} @ ${t.price}`,
        amount: t.proceeds,
        providerId: `${stamp}:${t.symbol}:cash`,
        groupRef: ref,
        raw: { ...t },
      });
      if (!isZero(t.commission)) {
        pushCash(t.currency, {
          postedOn: t.date,
          description: `Commission: ${t.symbol}`,
          amount: t.commission,
          providerId: `${stamp}:${t.symbol}:fee`,
          groupRef: ref,
          role: 'fee',
          raw: { ...t },
        });
      }
      const units = unitRows.get(t.symbol) ?? [];
      const row: ParsedRow = {
        rowIndex: rowIndex++,
        postedOn: t.date,
        description: `Buy ${t.quantity} ${t.symbol} @ ${t.price}`,
        amount: t.quantity,
        providerId: `${stamp}:${t.symbol}:units`,
        groupRef: ref,
        raw: { ...t },
      };
      units.push(row);
      unitRows.set(t.symbol, units);
      prices.push({
        symbol: t.symbol,
        exchange: instrument.exchange,
        on: t.date,
        price: t.price,
        currency: t.currency,
        priceType: 'trade',
        sourceRow: row.rowIndex,
      });
    } else {
      // AUD.USD: quantity is in AUD (the base), proceeds in USD (the quote); commission is in AUD.
      const [base, quote] = t.symbol.split('.') as [string, string];
      const ref = `ibkr:${accountId}:fx:${stamp}:${t.quantity}`;
      const description = `Convert ${t.symbol} @ ${t.price}`;
      pushCash(base, { postedOn: t.date, description, amount: t.quantity, providerId: `${ref}:${base}`, groupRef: ref, raw: { ...t } });
      pushCash(quote, { postedOn: t.date, description, amount: t.proceeds, providerId: `${ref}:${quote}`, groupRef: ref, raw: { ...t } });
      // The trade's own rate (AUD per USD = 1 / USD per AUD) is a trade-type FX observation; tiny
      // automatic conversions that settle sub-dollar residues are skipped as unrepresentative.
      if (base === REPORTING_CURRENCY && Math.abs(Number(t.proceeds)) >= 1) {
        prices.push({ ...fxSymbol(quote), on: t.date, price: div('1', t.price), currency: base, priceType: 'trade' });
      }
      if (!isZero(t.commission)) {
        pushCash(base, {
          postedOn: t.date,
          description: `Commission: ${t.symbol}`,
          amount: t.commission,
          providerId: `${ref}:fee`,
          groupRef: ref,
          role: 'fee',
          raw: { ...t },
        });
      }
    }
  }

  // Every currency's cash must reconcile (the report rounds to cents; FX rows can carry sub-cent amounts).
  for (const [currency, report] of cash) {
    const computed = add(report.starting, ...cashRows.get(currency)!.map((r) => r.amount));
    if (round2(computed) !== round2(report.ending)) {
      throw new UnsupportedStatementError(`${currency} cash does not reconcile: statement ${report.ending}, computed ${computed}`);
    }
  }

  const symbols = [...new Set([...positions.keys(), ...unitRows.keys(), ...priorQuantities.keys()])].sort();
  const holdingSections: ParsedAccountSection[] = symbols.map((symbol) => {
    const instrument = instruments.get(symbol);
    if (!instrument) throw new UnsupportedStatementError(`No instrument information for ${symbol}`);
    const rows = unitRows.get(symbol) ?? [];
    const opening = priorQuantities.get(symbol) ?? '0';
    const position = positions.get(symbol);
    const closing = position?.quantity ?? '0';
    if (!eq(add(opening, ...rows.map((r) => r.amount)), closing)) {
      throw new UnsupportedStatementError(`${symbol} position does not reconcile: ${opening} + trades ≠ ${closing}`);
    }
    if (position) {
      prices.push({
        symbol,
        exchange: instrument.exchange,
        on: periodEnd,
        price: position.closePrice,
        currency: position.currency,
        priceType: 'daily',
      });
    }
    return {
      identifier: symbol,
      maskedIdentifier: `${symbol} · ${instrument.exchange}`,
      name: symbol,
      accountType: 'brokerage',
      classification: 'asset',
      commodity: instrumentCommodity(instrument),
      instrument,
      openingBalance: { on: periodStart, balance: opening },
      closingBalance: { on: periodEnd, balance: closing },
      rows,
    };
  });

  const cashSections: ParsedAccountSection[] = [...cash].map(([currency, report]) => ({
    identifier: currency,
    maskedIdentifier: `${accountId.slice(0, 2)}•••${accountId.slice(-3)} ${currency}`,
    name: `IBKR ${currency}`,
    accountType: 'brokerage',
    classification: 'asset',
    commodity: currency,
    openingBalance: { on: periodStart, balance: report.starting },
    closingBalance: { on: periodEnd, balance: report.ending },
    rows: cashRows.get(currency)!,
  }));

  return {
    parserId: IBKR_PDF_PARSER_ID,
    parserVersion: IBKR_PDF_PARSER_VERSION,
    provider: 'ibkr',
    institutionName: 'IBKR',
    periodStart,
    periodEnd,
    accounts: [...cashSections, ...holdingSections],
    prices,
    warnings: [],
  };
}

/**
 * Starting and ending cash per currency. A statement with no activity lists only the base-currency
 * summary; that summary is then the base currency's own cash (callers check nothing else moved).
 */
function readCashReport(lines: TextLine[], baseCurrency: string) {
  const report = new Map<string, { starting: DecimalString; ending: DecimalString }>();
  const base = { starting: '0', ending: '0' };
  let currency: string | null = null;
  for (const line of lines) {
    if (line.text === 'Total' || line.text === 'Base Currency Summary') continue;
    if (line.items.length === 1 && CURRENCY_RE.test(line.text)) {
      currency = line.text;
      report.set(currency, { starting: '0', ending: '0' });
      continue;
    }
    const label = line.items[0]!.text;
    if (!CASH_LINES.includes(label)) throw new UnsupportedStatementError(`Cash report line "${label}" is not supported yet`);
    const value = num(line.items.at(-1)!.text);
    const target = currency ? report.get(currency)! : base;
    if (label === 'Starting Cash') target.starting = value;
    if (label === 'Ending Cash') target.ending = value;
  }
  if (report.size === 0) report.set(baseCurrency, base);
  return { report, perCurrency: report.size > 1 || !report.has(baseCurrency) || currency !== null };
}

function readDeposits(lines: TextLine[]) {
  const out: Array<{ currency: string; date: IsoDate; description: string; amount: DecimalString }> = [];
  let currency: string | null = null;
  for (const line of lines) {
    if (isHeader(line) || line.text.startsWith('Total')) continue;
    if (line.items.length === 1 && CURRENCY_RE.test(line.text)) {
      currency = line.text;
      continue;
    }
    const [date, ...rest] = line.items;
    if (!currency || !date || !/^\d{4}-\d{2}-\d{2}$/.test(date.text))
      throw new UnsupportedStatementError(`Unexpected deposit row: ${line.text}`);
    const amount = num(rest.at(-1)!.text);
    if (amount.startsWith('-')) throw new UnsupportedStatementError('Withdrawals are not supported yet');
    out.push({
      currency,
      date: date.text,
      description: rest
        .slice(0, -1)
        .map((i) => i.text)
        .join(' '),
      amount,
    });
  }
  return out;
}

function readTrades(lines: TextLine[]): Trade[] {
  const trades: Trade[] = [];
  let header: TextLine | null = null;
  let kind: Trade['kind'] | null = null;
  let currency: string | null = null;
  for (const block of blocks(lines)) {
    // A row is one content line, optionally with its date above and time below.
    const content = block.filter((l) => !/^\d{4}-\d{2}-\d{2},$|^\d{2}:\d{2}:\d{2}$/.test(l.text));
    if (content.length !== 1)
      throw new UnsupportedStatementError(`Could not separate trade rows near: ${block.map((l) => l.text).join(' / ')}`);
    const main = content[0]!;
    if (isHeader(main)) {
      header = main;
      continue;
    }
    if (main.text === 'Stocks' || main.text === 'Forex') {
      kind = main.text === 'Stocks' ? 'stock' : 'forex';
      continue;
    }
    if (main.items.length === 1 && CURRENCY_RE.test(main.text)) {
      currency = main.text;
      continue;
    }
    if (main.text.startsWith('Total')) continue;
    if (!header || !kind || !currency) throw new UnsupportedStatementError(`Unexpected trades layout: ${main.text}`);
    if (main.text.match(/^(Equity and Index Options|Futures|Bonds|Warrants|CFDs)/))
      throw new UnsupportedStatementError(`${main.text} trades are not supported yet`);

    const c = cells(
      header,
      block.flatMap((l) => l.items),
    );
    const date = c['Date/Time']?.match(/(\d{4}-\d{2}-\d{2}),?\s*(\d{2}:\d{2}:\d{2})/);
    if (!date) throw new UnsupportedStatementError(`Trade date not found: ${main.text}`);
    const quantity = num(c['Quantity'] ?? '');
    if (kind === 'stock' && quantity.startsWith('-')) throw new UnsupportedStatementError('Sells are not supported yet');
    const commission = num(c['Comm/Fee'] ?? c['Comm in AUD'] ?? '0');
    trades.push({
      kind,
      symbol: c['Symbol']!,
      currency,
      date: date[1]!,
      time: date[2]!,
      quantity,
      price: num(c['T. Price'] ?? ''),
      proceeds: num(c['Proceeds'] ?? ''),
      commission,
    });
  }
  for (const t of trades) {
    if (!NUMBER_RE.test(t.quantity) || !NUMBER_RE.test(t.price) || !NUMBER_RE.test(t.proceeds)) {
      throw new UnsupportedStatementError(`Could not read trade ${t.symbol} ${t.date}`);
    }
    if (t.kind === 'forex' && !/^[A-Z]{3}\.[A-Z]{3}$/.test(t.symbol))
      throw new UnsupportedStatementError(`Unexpected forex pair ${t.symbol}`);
    // A buy's proceeds are negative; anything else is not a buy we understand.
    if (t.kind === 'stock' && !t.proceeds.startsWith('-')) throw new UnsupportedStatementError(`Unexpected proceeds for ${t.symbol}`);
  }
  return trades;
}

function readPositions(lines: TextLine[]) {
  const out = new Map<string, { quantity: DecimalString; closePrice: DecimalString; currency: string }>();
  const header = lines.find(isHeader);
  let currency: string | null = null;
  for (const line of lines) {
    if (line === header || line.text === 'Stocks' || line.text.startsWith('Total')) continue;
    if (line.items.length === 1 && CURRENCY_RE.test(line.text)) {
      currency = line.text;
      continue;
    }
    if (!header || !currency) throw new UnsupportedStatementError(`Unexpected open positions layout: ${line.text}`);
    const c = cells(header, line.items);
    if (c['Mult'] !== '1') throw new UnsupportedStatementError(`Positions with a multiplier are not supported: ${line.text}`);
    out.set(c['Symbol']!, { quantity: num(c['Quantity']!), closePrice: num(c['Close Price']!), currency });
  }
  return out;
}

/** Opening quantities: the Mark-to-Market summary's "Prior" quantity per stock. */
function readPriorQuantities(lines: TextLine[]) {
  const out = new Map<string, DecimalString>();
  const header = lines.find((l) => l.items[0]?.text === 'Symbol');
  let inStocks = false;
  for (const line of lines) {
    if (line.text === 'Stocks') inStocks = true;
    else if (line.text === 'Forex') inStocks = false;
    else if (inStocks && header && line !== header && !line.text.startsWith('Total')) {
      // The first numeric column under "Prior" is the prior quantity.
      const prior = header.items.find((h) => h.text === 'Prior')!;
      const item = line.items.find((i) => NUMBER_RE.test(i.text) && Math.abs(i.right - prior.right) < 20);
      out.set(line.items[0]!.text, num(item?.text ?? '0'));
    }
  }
  return out;
}

const fxSymbol = (currency: string) => ({ symbol: currency, exchange: FX_EXCHANGE });

/**
 * Year-end FX marks: the Mark-to-Market summary's Forex rows give each currency's current price in
 * the base currency (e.g. USD 1.50 = AUD per USD) at the period end. Recorded as daily FX rates.
 */
function readFxMarks(lines: TextLine[], periodEnd: IsoDate): ParsedPrice[] {
  const out: ParsedPrice[] = [];
  let inForex = false;
  for (const line of lines) {
    if (line.text === 'Forex') inForex = true;
    else if (line.text === 'Stocks') inForex = false;
    else if (inForex && line.items.length > 1 && CURRENCY_RE.test(line.items[0]!.text) && line.items[0]!.text !== REPORTING_CURRENCY) {
      // Columns: prior quantity, current quantity, prior price, current price, …
      // `--` stands in for a missing prior price, so it keeps its column position.
      const numbers = line.items.slice(1).filter((i) => NUMBER_RE.test(i.text) || i.text === '--');
      const current = numbers[3]?.text;
      if (current && NUMBER_RE.test(current) && Number(current) > 0) {
        out.push({
          ...fxSymbol(line.items[0]!.text),
          on: periodEnd,
          price: num(current),
          currency: REPORTING_CURRENCY,
          priceType: 'daily',
        });
      }
    }
  }
  return out;
}

function readInstruments(lines: TextLine[]) {
  const out = new Map<string, ParsedInstrument>();
  const header = lines.find((l) => l.items[0]?.text === 'Symbol');
  for (const line of lines) {
    if (!header || line === header || line.text === 'Stocks' || line.items.length < 3) continue;
    const c = cells(header, line.items, 'left');
    const exchange = EXCHANGES[c['Listing Exch'] ?? ''];
    if (!exchange) throw new UnsupportedStatementError(`Unsupported listing exchange for ${c['Symbol']}: ${c['Listing Exch']}`);
    if (c['Type'] !== 'COMMON' && c['Type'] !== 'ETF') throw new UnsupportedStatementError(`Unsupported instrument type ${c['Type']}`);
    const symbol = c['Symbol']!;
    // Currency is refined from the trades/positions sections by the caller.
    out.set(symbol, {
      symbol,
      exchange,
      name: c['Description'] ?? symbol,
      currency: exchange === 'XASX' ? 'AUD' : 'USD',
      isin: c['Security ID'],
    });
  }
  return out;
}
