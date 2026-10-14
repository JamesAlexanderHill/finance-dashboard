import { isoDate, type DecimalString, type IsoDate } from '@finance/shared';

/** Parses CSV text (RFC 4180: quoted fields, escaped quotes, CRLF) into rows of strings. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const input = text.replace(/^﻿/, '');
  for (let i = 0; i < input.length; i++) {
    const c = input[i]!;
    if (quoted) {
      if (c === '"' && input[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"' && field === '') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && input[i + 1] === '\n') i++;
      row.push(field);
      if (row.some((f) => f.trim() !== '')) rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f.trim() !== '')) rows.push(row);
  return rows;
}

export const PRICE_CSV_MAPPING_VERSION = '1';
export const DATE_FORMATS = ['YYYY-MM-DD', 'DD/MM/YYYY', 'MM/DD/YYYY'] as const;
export type DateFormat = (typeof DATE_FORMATS)[number];

/** How a price CSV's columns map onto price observations (columns are header names). */
export interface PriceCsvMapping {
  dateColumn: string;
  dateFormat: DateFormat;
  priceColumn: string;
  /** Either one instrument for every row, or a column naming each row's instrument. */
  instrumentId?: string;
  instrumentColumn?: string;
  /** Either a fixed currency, or a column; defaults to the instrument's currency. */
  currency?: string;
  currencyColumn?: string;
}

export interface ResolvedInstrument {
  id: string;
  currency: string;
}

export interface MappedPrice {
  /** 1-based line number in the file, header included, for provenance and error reports. */
  line: number;
  instrumentId: string;
  observedOn: IsoDate;
  price: DecimalString;
  currency: string;
}

export interface RowError {
  line: number;
  error: string;
}

export function parseDate(value: string, format: DateFormat): IsoDate | null {
  const v = value.trim();
  const m = format === 'YYYY-MM-DD' ? v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/) : v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const [y, mo, d] =
    format === 'YYYY-MM-DD'
      ? [Number(m[1]), Number(m[2]), Number(m[3])]
      : format === 'DD/MM/YYYY'
        ? [Number(m[3]), Number(m[2]), Number(m[1])]
        : [Number(m[3]), Number(m[1]), Number(m[2])];
  const iso = isoDate(y, mo, d);
  // Reject impossible dates such as 31/02/2025 rather than letting Date roll them over.
  return new Date(`${iso}T00:00:00Z`).toISOString().slice(0, 10) === iso ? iso : null;
}

function parsePrice(value: string): DecimalString | null {
  const v = value.trim().replace(/^\$/, '').replace(/,/g, '');
  return /^\d+(\.\d+)?$/.test(v) && Number(v) > 0 ? v : null;
}

/**
 * Validates and maps CSV rows to price observations. Every rejected row is reported with its line and
 * reason (invalid date, bad or non-positive price, unknown instrument, unsupported currency) rather
 * than skipped silently; exact duplicate rows within the file are reported too.
 */
export function mapPriceRows(
  rows: string[][],
  mapping: PriceCsvMapping,
  resolveInstrument: (value: string) => ResolvedInstrument | null,
  fixedInstrument: ResolvedInstrument | null,
): { prices: MappedPrice[]; errors: RowError[] } {
  const [header, ...body] = rows;
  if (!header) return { prices: [], errors: [{ line: 1, error: 'The file is empty' }] };
  const column = (name: string | undefined) => (name ? header.findIndex((h) => h.trim() === name) : -1);
  const [dateCol, priceCol, instrumentCol, currencyCol] = [
    column(mapping.dateColumn),
    column(mapping.priceColumn),
    column(mapping.instrumentColumn),
    column(mapping.currencyColumn),
  ];
  const missing = [
    dateCol < 0 && mapping.dateColumn,
    priceCol < 0 && mapping.priceColumn,
    mapping.instrumentColumn && instrumentCol < 0 && mapping.instrumentColumn,
    mapping.currencyColumn && currencyCol < 0 && mapping.currencyColumn,
  ].filter(Boolean);
  if (missing.length) return { prices: [], errors: [{ line: 1, error: `Column not found: ${missing.join(', ')}` }] };
  if (!fixedInstrument && instrumentCol < 0)
    return { prices: [], errors: [{ line: 1, error: 'Choose an instrument or an instrument column' }] };

  const prices: MappedPrice[] = [];
  const errors: RowError[] = [];
  const seen = new Set<string>();
  body.forEach((row, i) => {
    const line = i + 2;
    const observedOn = parseDate(row[dateCol] ?? '', mapping.dateFormat);
    if (!observedOn) return errors.push({ line, error: `Invalid date "${row[dateCol] ?? ''}" (expected ${mapping.dateFormat})` });
    const price = parsePrice(row[priceCol] ?? '');
    if (!price) return errors.push({ line, error: `Invalid price "${row[priceCol] ?? ''}"` });
    const instrument = instrumentCol >= 0 ? resolveInstrument((row[instrumentCol] ?? '').trim()) : fixedInstrument;
    if (!instrument) return errors.push({ line, error: `Unknown instrument "${row[instrumentCol] ?? ''}"` });
    const currency = (currencyCol >= 0 ? row[currencyCol] : mapping.currency)?.trim().toUpperCase() || instrument.currency;
    if (!/^[A-Z]{3}$/.test(currency)) return errors.push({ line, error: `Unsupported currency "${currency}"` });
    const key = `${instrument.id}|${observedOn}|${currency}|${price}`;
    if (seen.has(key)) return errors.push({ line, error: 'Duplicate of an earlier row in this file' });
    seen.add(key);
    prices.push({ line, instrumentId: instrument.id, observedOn, price, currency });
  });
  return { prices, errors };
}
