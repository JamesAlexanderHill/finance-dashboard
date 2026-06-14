import * as React from 'react'
import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react'
import cn from '~/lib/class-merge'
import { addMonths, isSameDay, startOfMonth, type DateRange } from '~/lib/date-range'

const WEEKDAY_LABELS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']

type CalendarProps = {
  /** The currently selected range. `start: null` means no range start is set (e.g. "All time"). */
  range: DateRange
  /** Called when a day is clicked — the caller decides whether this starts a new range or completes one. */
  onDayClick: (date: Date) => void
  /** Dates after this are disabled. */
  maxDate?: Date
}

/** A single-month range-picker grid (Monday-first, en-AU). Highlights the days between `range.start` and `range.end`. */
export default function Calendar({ range, onDayClick, maxDate }: CalendarProps) {
  const [viewMonth, setViewMonth] = React.useState(() => startOfMonth(range.start ?? range.end))

  const days = React.useMemo(() => buildMonthGrid(viewMonth), [viewMonth])

  return (
    <div className="select-none">
      <div className="flex items-center justify-between mb-2">
        <button
          type="button"
          onClick={() => setViewMonth((m) => addMonths(m, -1))}
          className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500 dark:text-gray-400"
        >
          <ChevronLeftIcon className="size-4" />
        </button>
        <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
          {viewMonth.toLocaleDateString('en-AU', { month: 'long', year: 'numeric' })}
        </span>
        <button
          type="button"
          onClick={() => setViewMonth((m) => addMonths(m, 1))}
          className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500 dark:text-gray-400"
        >
          <ChevronRightIcon className="size-4" />
        </button>
      </div>
      <div className="grid grid-cols-7 gap-y-1 text-center">
        {WEEKDAY_LABELS.map((label) => (
          <span key={label} className="text-xs text-gray-400 dark:text-gray-500">
            {label}
          </span>
        ))}
        {days.map((day) => {
          const disabled = !!maxDate && day.getTime() > maxDate.getTime()
          const inMonth = day.getUTCMonth() === viewMonth.getUTCMonth()
          const inRange = !!range.start && day.getTime() >= range.start.getTime() && day.getTime() <= range.end.getTime()
          const isStart = !!range.start && isSameDay(day, range.start)
          const isEnd = !!range.start && isSameDay(day, range.end)
          const isEndpoint = isStart || isEnd
          return (
            <div
              key={day.toISOString()}
              className={cn(inRange && 'bg-blue-50 dark:bg-blue-950', isStart && 'rounded-l-full', isEnd && 'rounded-r-full')}
            >
              <button
                type="button"
                disabled={disabled}
                onClick={() => onDayClick(day)}
                className={cn(
                  'w-full text-xs rounded-full py-1 tabular-nums',
                  inMonth ? 'text-gray-700 dark:text-gray-300' : 'text-gray-300 dark:text-gray-600',
                  isEndpoint && 'bg-blue-600 text-white hover:bg-blue-600',
                  !isEndpoint && inRange && 'text-blue-900 dark:text-blue-100',
                  !isEndpoint && !disabled && 'hover:bg-gray-100 dark:hover:bg-gray-800',
                  disabled && 'opacity-30 cursor-not-allowed',
                )}
              >
                {day.getUTCDate()}
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/**
 * Builds a 6x7 grid of UTC dates covering `month` plus leading/trailing days
 * from adjacent months, starting on the Monday on or before the 1st.
 */
function buildMonthGrid(month: Date): Date[] {
  const first = startOfMonth(month)
  const startOffset = (first.getUTCDay() + 6) % 7
  const gridStart = new Date(first)
  gridStart.setUTCDate(gridStart.getUTCDate() - startOffset)

  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(gridStart)
    d.setUTCDate(d.getUTCDate() + i)
    return d
  })
}
