/** A date range for the balance history chart. `start: null` means "from the beginning of history". */
export type DateRange = { start: Date | null; end: Date }

/** Serialized form of `DateRange`, safe to pass across the server-fn boundary. */
export type SerializedDateRange = { start: string | null; end: string }

export function todayUTC(): Date {
  const now = new Date()
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
}

export function addDays(date: Date, days: number): Date {
  const d = new Date(date)
  d.setUTCDate(d.getUTCDate() + days)
  return d
}

export function addMonths(date: Date, months: number): Date {
  const d = new Date(date)
  d.setUTCMonth(d.getUTCMonth() + months)
  return d
}

export function startOfMonth(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1))
}

export function startOfYear(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), 0, 1))
}

/** Start of the Australian financial year (1 Jul) containing `date`. */
export function startOfFinancialYear(date: Date): Date {
  const fyStartYear = date.getUTCMonth() >= 6 ? date.getUTCFullYear() : date.getUTCFullYear() - 1
  return new Date(Date.UTC(fyStartYear, 6, 1))
}

export function isSameDay(a: Date, b: Date): boolean {
  return a.getUTCFullYear() === b.getUTCFullYear() && a.getUTCMonth() === b.getUTCMonth() && a.getUTCDate() === b.getUTCDate()
}

export function toISODate(date: Date): string {
  return date.toISOString().slice(0, 10)
}

// `toLocaleDateString('en-AU', { month: 'short' })` is inconsistent across runtimes
// (Bun returns "Jun", Chromium returns "June" for the same locale/options), which causes
// SSR/client hydration mismatches for this text. Use a fixed table instead.
const MONTH_ABBREVIATIONS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function formatDate(date: Date): string {
  return `${date.getUTCDate()} ${MONTH_ABBREVIATIONS[date.getUTCMonth()]} ${date.getUTCFullYear()}`
}

export function formatRange(range: DateRange): string {
  const end = formatDate(range.end)
  return range.start ? `${formatDate(range.start)} – ${end}` : `All time – ${end}`
}

export function serializeRange(range: DateRange): SerializedDateRange {
  return { start: range.start ? toISODate(range.start) : null, end: toISODate(range.end) }
}

export function rangesEqual(a: DateRange, b: DateRange): boolean {
  const aStart = a.start?.getTime() ?? null
  const bStart = b.start?.getTime() ?? null
  return aStart === bStart && a.end.getTime() === b.end.getTime()
}

/** Default balance history window: the trailing 30 days, including today. */
export function defaultBalanceHistoryRange(): DateRange {
  const end = todayUTC()
  return { start: addDays(end, -29), end }
}

export type RangePreset = {
  label: string
  range: () => DateRange
}

export const RANGE_PRESETS: RangePreset[] = [
  { label: 'Last 7 days', range: () => ({ start: addDays(todayUTC(), -6), end: todayUTC() }) },
  { label: 'Last 30 days', range: () => ({ start: addDays(todayUTC(), -29), end: todayUTC() }) },
  { label: 'Last 90 days', range: () => ({ start: addDays(todayUTC(), -89), end: todayUTC() }) },
  { label: 'This month', range: () => ({ start: startOfMonth(todayUTC()), end: todayUTC() }) },
  { label: 'Year to date', range: () => ({ start: startOfYear(todayUTC()), end: todayUTC() }) },
  { label: 'This financial year', range: () => ({ start: startOfFinancialYear(todayUTC()), end: todayUTC() }) },
  {
    label: 'Last financial year',
    range: () => {
      const thisFyStart = startOfFinancialYear(todayUTC())
      return { start: addMonths(thisFyStart, -12), end: addDays(thisFyStart, -1) }
    },
  },
  { label: 'Last 12 months', range: () => ({ start: addMonths(todayUTC(), -12), end: todayUTC() }) },
  { label: 'All time', range: () => ({ start: null, end: todayUTC() }) },
]
