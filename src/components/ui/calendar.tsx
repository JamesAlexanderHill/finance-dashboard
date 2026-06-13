import * as React from 'react'
import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react'
import cn from '~/lib/class-merge'
import { addMonths, isSameDay, startOfMonth } from '~/lib/date-range'

const WEEKDAY_LABELS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']

type CalendarProps = {
  /** The currently selected date, or null if none. */
  value: Date | null
  onChange: (date: Date) => void
  /** Dates after this are disabled. */
  maxDate?: Date
  /** Dates before this are disabled. */
  minDate?: Date
}

/** A single-month date picker grid (Monday-first, en-AU). */
export default function Calendar({ value, onChange, maxDate, minDate }: CalendarProps) {
  const [viewMonth, setViewMonth] = React.useState(() => startOfMonth(value ?? maxDate ?? new Date()))

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
          const disabled = (!!maxDate && day.getTime() > maxDate.getTime()) || (!!minDate && day.getTime() < minDate.getTime())
          const inMonth = day.getUTCMonth() === viewMonth.getUTCMonth()
          const selected = !!value && isSameDay(day, value)
          return (
            <button
              key={day.toISOString()}
              type="button"
              disabled={disabled}
              onClick={() => onChange(day)}
              className={cn(
                'text-xs rounded-md py-1 tabular-nums',
                inMonth ? 'text-gray-700 dark:text-gray-300' : 'text-gray-300 dark:text-gray-600',
                selected && 'bg-blue-600 text-white hover:bg-blue-600',
                !selected && !disabled && 'hover:bg-gray-100 dark:hover:bg-gray-800',
                disabled && 'opacity-30 cursor-not-allowed',
              )}
            >
              {day.getUTCDate()}
            </button>
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
