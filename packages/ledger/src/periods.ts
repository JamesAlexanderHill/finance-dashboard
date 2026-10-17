import { addDays, addMonths, daysBetween, endOfMonth, startOfMonth, type DateRange, type IsoDate } from '@finance/shared';

export type Granularity = 'week' | 'month' | 'quarter' | 'year' | 'custom';
/** How finely a chart buckets its page period. */
export type Resolution = 'day' | 'week' | 'month' | 'quarter' | 'year';

export interface Period {
  from: IsoDate;
  to: IsoDate;
  label: string;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const parts = (d: IsoDate) => d.split('-').map(Number) as [number, number, number];
const short = (d: IsoDate) => `${parts(d)[2]} ${MONTHS[parts(d)[1] - 1]}`;

/** The day, week (Monday–Sunday), month, quarter or year containing a date. */
export function periodContaining(date: IsoDate, granularity: Resolution): Period {
  const [y, m] = parts(date);
  if (granularity === 'day') return { from: date, to: date, label: short(date) };
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
    const length = daysBetween(anchor.from, anchor.to) + 1;
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

/** Most buckets a chart is drawn with; a finer resolution falls back to a coarser one. */
export const MAX_BUCKETS = 400;
const COARSER: Record<Resolution, Resolution | null> = { day: 'week', week: 'month', month: 'quarter', quarter: 'year', year: null };

/**
 * The range split into calendar buckets at a resolution, oldest first; the first and last are clipped
 * to the range. Too many buckets coarsen the resolution, so the result says which one applied.
 */
export function bucketsIn(range: DateRange, resolution: Resolution): { resolution: Resolution; buckets: Period[] } {
  const buckets: Period[] = [];
  for (let date = range.from; date <= range.to; ) {
    const p = periodContaining(date, resolution);
    buckets.push({ ...p, from: date, to: p.to < range.to ? p.to : range.to });
    if (buckets.length > MAX_BUCKETS && COARSER[resolution]) return bucketsIn(range, COARSER[resolution]!);
    date = addDays(p.to, 1);
  }
  return { resolution, buckets };
}
