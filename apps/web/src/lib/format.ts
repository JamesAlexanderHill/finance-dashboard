import { dec } from '@finance/shared';

// Formatting is hand-rolled rather than Intl-based so server (Bun) and browser render identical
// text; their ICU data differs (e.g. "Sep" vs "Sept"), which breaks hydration.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const LONG_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** Formats a decimal string for display, e.g. `-$1,234.50`. Display only; never parse the result back. */
export function money(value: string | null | undefined, currency = 'AUD') {
  if (value == null) return '—';
  const fixed = dec(value).toFixed(2);
  const negative = fixed.startsWith('-');
  const [whole, cents] = fixed.replace('-', '').split('.') as [string, string];
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  if (currency === 'AUD') return `${negative ? '-' : ''}$${grouped}.${cents}`;
  return `${negative ? '-' : ''}${grouped}.${cents} ${currency}`;
}

/** `2026-09-11` → `11 Sep 2026`. */
export function shortDate(iso: string | null | undefined) {
  if (!iso) return '—';
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number) as [number, number, number];
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

/** `2026-09-01` → `September 2026`. */
export function monthYear(iso: string) {
  const [y, m] = iso.split('-').map(Number) as [number, number];
  return `${LONG_MONTHS[m - 1]} ${y}`;
}

export function bytes(n: number) {
  return n < 1024 * 1024 ? `${Math.round(n / 1024)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`;
}
