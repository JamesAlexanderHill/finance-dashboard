import { describe, expect, test } from 'bun:test';
import { mapPriceRows, parseCsv, parseDate } from '../src/prices-csv';

const vas = { id: 'vas', currency: 'AUD' };
const vgs = { id: 'vgs', currency: 'AUD' };
const resolve = (v: string) => ({ VAS: vas, 'VGS.AX': vgs })[v] ?? null;

describe('CSV parsing', () => {
  test('handles quotes, escaped quotes, CRLF, a BOM and blank lines', () => {
    expect(parseCsv('﻿Date,Note\r\n2025-01-02,"a, ""b"""\r\n\r\n2025-01-03,c\n')).toEqual([
      ['Date', 'Note'],
      ['2025-01-02', 'a, "b"'],
      ['2025-01-03', 'c'],
    ]);
  });

  test('parses each date format and rejects impossible dates', () => {
    expect(parseDate('2025-03-04', 'YYYY-MM-DD')).toBe('2025-03-04');
    expect(parseDate('04/03/2025', 'DD/MM/YYYY')).toBe('2025-03-04');
    expect(parseDate('03/04/2025', 'MM/DD/YYYY')).toBe('2025-03-04');
    expect(parseDate('31/02/2025', 'DD/MM/YYYY')).toBeNull();
  });
});

describe('price row mapping', () => {
  test('maps a single-instrument file and reports every invalid row with its line', () => {
    const rows = parseCsv('Date,Close\n02/01/2025,"$1,001.50"\nnot a date,1\n03/01/2025,-4\n06/01/2025,0\n02/01/2025,1001.50\n');
    const { prices, errors } = mapPriceRows(rows, { dateColumn: 'Date', dateFormat: 'DD/MM/YYYY', priceColumn: 'Close' }, resolve, vas);
    expect(prices).toEqual([{ line: 2, instrumentId: 'vas', observedOn: '2025-01-02', price: '1001.50', currency: 'AUD' }]);
    expect(errors.map((e) => e.line)).toEqual([3, 4, 5, 6]);
    expect(errors[3]!.error).toContain('Duplicate');
  });

  test('resolves an instrument column and validates currency', () => {
    const rows = parseCsv('Symbol,Date,Price,Ccy\nVAS,2025-01-02,100,aud\nVGS.AX,2025-01-02,150,USDX\nIVV,2025-01-02,50,USD\n');
    const { prices, errors } = mapPriceRows(
      rows,
      { dateColumn: 'Date', dateFormat: 'YYYY-MM-DD', priceColumn: 'Price', instrumentColumn: 'Symbol', currencyColumn: 'Ccy' },
      resolve,
      null,
    );
    expect(prices.map((p) => [p.instrumentId, p.currency])).toEqual([['vas', 'AUD']]);
    expect(errors.map((e) => e.error)).toEqual(['Unsupported currency "USDX"', 'Unknown instrument "IVV"']);
  });

  test('reports a missing mapped column once instead of failing every row', () => {
    const { errors } = mapPriceRows(
      parseCsv('Date,Close\n'),
      { dateColumn: 'Date', dateFormat: 'YYYY-MM-DD', priceColumn: 'Adj Close' },
      resolve,
      vas,
    );
    expect(errors).toEqual([{ line: 1, error: 'Column not found: Adj Close' }]);
  });
});
