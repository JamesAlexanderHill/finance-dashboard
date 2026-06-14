import * as React from 'react'
import { Popover } from '@base-ui/react/popover'
import { CalendarIcon } from 'lucide-react'
import cn from '~/lib/class-merge'
import Calendar from '~/components/ui/calendar'
import { RANGE_PRESETS, formatRange, rangesEqual, todayUTC, type DateRange } from '~/lib/date-range'

type DateRangePickerProps = {
  value: DateRange
  onChange: (range: DateRange) => void
}

/** A Stripe-style date range picker: common presets alongside a single range-highlighting calendar. */
export default function DateRangePicker({ value, onChange }: DateRangePickerProps) {
  const [open, setOpen] = React.useState(false)
  const [draft, setDraft] = React.useState<DateRange>(value)
  // True once the user has clicked a start day and is now picking the end day.
  const [selectingEnd, setSelectingEnd] = React.useState(false)
  // Bumped whenever the calendar's visible month should jump to match `draft` (open, or a preset was picked).
  const [calendarKey, setCalendarKey] = React.useState(0)

  React.useEffect(() => {
    if (open) {
      setDraft(value)
      setSelectingEnd(false)
      setCalendarKey((k) => k + 1)
    }
  }, [open, value])

  function apply() {
    onChange(draft)
    setOpen(false)
  }

  function selectPreset(range: DateRange) {
    setDraft(range)
    setSelectingEnd(false)
    setCalendarKey((k) => k + 1)
  }

  function handleDayClick(day: Date) {
    if (!selectingEnd) {
      setDraft({ start: day, end: day })
      setSelectingEnd(true)
      return
    }
    setDraft((prev) => (prev.start && day.getTime() < prev.start.getTime() ? { start: day, end: prev.end } : { start: prev.start, end: day }))
    setSelectingEnd(false)
  }

  const activePreset = RANGE_PRESETS.find((preset) => rangesEqual(preset.range(), draft))

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 dark:border-gray-700 px-2.5 py-1 text-xs font-medium text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 transition-colors">
        <CalendarIcon className="size-3.5" />
        {formatRange(value)}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner sideOffset={4} align="end" className="z-50 outline-none">
          <Popover.Popup className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-md shadow-lg p-3 data-open:animate-in data-closed:animate-out data-closed:fade-out-0 data-open:fade-in-0">
            <div className="flex gap-4">
              <div className="flex flex-col gap-0.5 pr-3 border-r border-gray-100 dark:border-gray-800 min-w-[9.5rem]">
                {RANGE_PRESETS.map((preset) => (
                  <button
                    key={preset.label}
                    type="button"
                    onClick={() => selectPreset(preset.range())}
                    className={cn(
                      'text-left text-xs px-2 py-1.5 rounded-md transition-colors whitespace-nowrap',
                      activePreset?.label === preset.label
                        ? 'bg-blue-50 dark:bg-blue-950 text-blue-600 dark:text-blue-400 font-medium'
                        : 'text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800',
                    )}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
              <div>
                <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">{formatRange(draft)}</p>
                <Calendar key={calendarKey} range={draft} onDayClick={handleDayClick} maxDate={todayUTC()} />
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 mt-3 pt-3 border-t border-gray-100 dark:border-gray-800">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="px-3 py-1.5 text-xs text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={apply}
                className="px-3 py-1.5 text-xs font-medium bg-blue-600 hover:bg-blue-700 text-white rounded-md"
              >
                Apply
              </button>
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  )
}
