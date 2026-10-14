import { addDays, addMonths, endOfMonth, startOfMonth, type IsoDate } from '@finance/shared';

export type Granularity = 'week' | 'month' | 'quarter' | 'year' | 'custom';

export interface Period {
  from: IsoDate;
  to: IsoDate;
  label: string;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const parts = (d: IsoDate) => d.split('-').map(Number) as [number, number, number];
const short = (d: IsoDate) => `${parts(d)[2]} ${MONTHS[parts(d)[1] - 1]}`;
const days = (a: IsoDate, b: IsoDate) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

/** The week (Monday–Sunday), month, quarter or year containing a date. */
export function periodContaining(date: IsoDate, granularity: Exclude<Granularity, 'custom'>): Period {
  const [y, m] = parts(date);
  if (granularity === 'week') {
    const weekday = (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7; // Monday = 0
    const from = addDays(date, -weekday);
    return { from, to: addDays(from, 6), label: `w/c ${short(from)}` };
  }
  if (granularity === 'month') return { from: startOfMonth(date), to: endOfMonth(date), label: `${MONTHS[m - 1]} ${y}` };
  if (granularity === 'quarter') {
    const q = Math.floor((m - 1) / 3);
    const from = `${y}-${String(q * 3 + 1).padStart(2, '0')}-01`;
    return { from, to: endOfMonth(addMonths(from, 2)), label: `Q${q + 1} ${y}` };
  }
  return { from: `${y}-01-01`, to: `${y}-12-31`, label: String(y) };
}

/**
 * The selected period and the N before it, oldest first. A custom range is compared with the N
 * preceding ranges of the same length.
 */
export function periodSeries(granularity: Granularity, anchor: { date: IsoDate } | { from: IsoDate; to: IsoDate }, n: number): Period[] {
  if (granularity === 'custom') {
    if (!('from' in anchor)) throw new Error('A custom period needs from and to');
    const length = days(anchor.from, anchor.to) + 1;
    return Array.from({ length: n + 1 }, (_, i) => {
      const from = addDays(anchor.from, -length * (n - i));
      const to = addDays(from, length - 1);
      return { from, to, label: `${short(from)} – ${short(to)}` };
    });
  }
  const date = 'date' in anchor ? anchor.date : anchor.to;
  const out = [periodContaining(date, granularity)];
  while (out.length < n + 1) out.unshift(periodContaining(addDays(out[0]!.from, -1), granularity));
  return out;
}
