const aud = new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' });

/** Formats a decimal string for display. Display only; never parse the result back. */
export function money(value: string | null | undefined, currency = 'AUD') {
  if (value == null) return '—';
  const n = Number(value);
  return currency === 'AUD' ? aud.format(n) : `${n.toLocaleString('en-AU', { minimumFractionDigits: 2 })} ${currency}`;
}

export function shortDate(iso: string | null | undefined) {
  if (!iso) return '—';
  return new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function bytes(n: number) {
  return n < 1024 * 1024 ? `${Math.round(n / 1024)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`;
}
