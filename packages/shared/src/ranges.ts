import { addDays, addMonths, endOfMonth, startOfMonth, type IsoDate } from './dates';

/** An inclusive date range, e.g. the dashboard's page period. */
export interface DateRange {
  from: IsoDate;
  to: IsoDate;
}

export const RANGE_PRESETS = [
  { id: 'this-month', label: 'This month' },
  { id: 'last-month', label: 'Last month' },
  { id: 'this-quarter', label: 'This quarter' },
  { id: 'last-quarter', label: 'Last quarter' },
  { id: 'ytd', label: 'Year to date' },
  { id: 'last-year', label: 'Last year' },
  { id: 'last-30', label: 'Last 30 days' },
  { id: 'last-90', label: 'Last 90 days' },
  { id: 'last-12m', label: 'Last 12 months' },
] as const;
export type RangePreset = (typeof RANGE_PRESETS)[number]['id'];

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const parts = (d: IsoDate) => d.split('-').map(Number) as [number, number, number];
export const daysBetween = (a: IsoDate, b: IsoDate) =>
  Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

const quarterStart = (date: IsoDate) => {
  const [y, m] = parts(date);
  return `${y}-${String(Math.floor((m - 1) / 3) * 3 + 1).padStart(2, '0')}-01`;
};

/** The range a preset names, relative to today. "This" month/quarter run to their end, so future days are empty. */
export function presetRange(preset: RangePreset, today: IsoDate): DateRange {
  const [y] = parts(today);
  switch (preset) {
    case 'this-month':
      return { from: startOfMonth(today), to: endOfMonth(today) };
    case 'last-month': {
      const from = addMonths(today, -1);
      return { from, to: endOfMonth(from) };
    }
    case 'this-quarter': {
      const from = quarterStart(today);
      return { from, to: endOfMonth(addMonths(from, 2)) };
    }
    case 'last-quarter': {
      const from = addMonths(quarterStart(today), -3);
      return { from, to: endOfMonth(addMonths(from, 2)) };
    }
    case 'ytd':
      return { from: `${y}-01-01`, to: today };
    case 'last-year':
      return { from: `${y - 1}-01-01`, to: `${y - 1}-12-31` };
    case 'last-30':
      return { from: addDays(today, -29), to: today };
    case 'last-90':
      return { from: addDays(today, -89), to: today };
    case 'last-12m':
      return { from: addDays(shiftMonthsKeepDay(today, -12), 1), to: today };
  }
}

const isMonthStart = (d: IsoDate) => d.endsWith('-01');
const isMonthEnd = (d: IsoDate) => endOfMonth(d) === d;
const monthSpan = (r: DateRange) => {
  const [fy, fm] = parts(r.from);
  const [ty, tm] = parts(r.to);
  return (ty - fy) * 12 + (tm - fm) + 1;
};
/** The same day of the month `months` away, clamped to that month's last day. */
const shiftMonthsKeepDay = (date: IsoDate, months: number) => {
  const first = addMonths(date, months);
  const day = Math.min(parts(date)[2], parts(endOfMonth(first))[2]);
  return `${first.slice(0, 8)}${String(day).padStart(2, '0')}`;
};

/**
 * The range `steps` periods before (negative) or after (positive) this one. Whole calendar months
 * (a month, quarter or year) move by whole months; a range starting 1 January and ending within that
 * year (year to date) moves by a year; anything else moves by its own length in days.
 */
export function shiftRange(range: DateRange, steps: number): DateRange {
  if (isMonthStart(range.from) && isMonthEnd(range.to)) {
    const months = monthSpan(range) * steps;
    const from = addMonths(range.from, months);
    return { from, to: endOfMonth(addMonths(range.to, months)) };
  }
  if (range.from.endsWith('-01-01') && range.from.slice(0, 4) === range.to.slice(0, 4)) {
    return { from: shiftMonthsKeepDay(range.from, 12 * steps), to: shiftMonthsKeepDay(range.to, 12 * steps) };
  }
  const length = daysBetween(range.from, range.to) + 1;
  return { from: addDays(range.from, length * steps), to: addDays(range.to, length * steps) };
}

/** The period a range is compared with: the one before it (see `shiftRange`). */
export const previousRange = (range: DateRange) => shiftRange(range, -1);

const short = (d: IsoDate) => `${parts(d)[2]} ${MONTHS[parts(d)[1] - 1]}`;

/** `Oct 2026`, `Q3 2026`, `2026`, or `1 Jan – 17 Oct 2026`. */
export function rangeLabel(range: DateRange): string {
  const [fy, fm] = parts(range.from);
  const [ty] = parts(range.to);
  if (isMonthStart(range.from) && isMonthEnd(range.to)) {
    const span = monthSpan(range);
    if (span === 1) return `${MONTHS[fm - 1]} ${fy}`;
    if (span === 3 && (fm - 1) % 3 === 0) return `Q${(fm - 1) / 3 + 1} ${fy}`;
    if (span === 12 && fm === 1) return String(fy);
  }
  return fy === ty ? `${short(range.from)} – ${short(range.to)} ${ty}` : `${short(range.from)} ${fy} – ${short(range.to)} ${ty}`;
}
