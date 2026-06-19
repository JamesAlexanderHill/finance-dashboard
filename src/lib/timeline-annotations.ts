import { addDays } from '~/lib/date-range'

export type RecurrenceRule =
  | { frequency: 'weekly' }
  | { frequency: 'monthly' }
  | { frequency: 'yearly' }

/** Structural subset used by expandAnnotations — structurally compatible with the DB $inferSelect row. */
export type AnnotationForExpansion = {
  id: string
  accountId: string
  label: string
  date: Date
  endDate?: Date | null
  recurrence: RecurrenceRule | null
  color?: string | null
}

export type ExpandedAnnotation = {
  annotation: AnnotationForExpansion
  occurrenceDate: Date
  /** Set when the annotation spans a range. */
  endDate?: Date | null
}

/**
 * Like addMonths but clamps the day-of-month to the last day of the target month
 * instead of rolling over into the next month (e.g. Jan 31 + 1 month → Feb 28, not Mar 3).
 */
function addMonthsClamped(date: Date, months: number): Date {
  const originalDay = date.getUTCDate()
  const result = new Date(date)
  // Set to the 1st to prevent rollover when changing the month
  result.setUTCDate(1)
  result.setUTCMonth(result.getUTCMonth() + months)
  // Days in the target month
  const daysInMonth = new Date(Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0)).getUTCDate()
  result.setUTCDate(Math.min(originalDay, daysInMonth))
  return result
}

/**
 * Expands stored annotations into concrete occurrences within [rangeStart, rangeEnd] (inclusive).
 *
 * One-time annotations produce at most one occurrence (the anchor date, if in range).
 * Recurring annotations produce all occurrences at their cadence within the range,
 * walking forward and backward from the anchor date.
 */
export function expandAnnotations(
  annotations: AnnotationForExpansion[],
  rangeStart: Date,
  rangeEnd: Date,
): ExpandedAnnotation[] {
  if (rangeStart.getTime() > rangeEnd.getTime()) return []

  const results: ExpandedAnnotation[] = []
  const startMs = rangeStart.getTime()
  const endMs = rangeEnd.getTime()

  for (const annotation of annotations) {
    const annotEndDate = annotation.endDate ?? null
    if (!annotation.recurrence) {
      const t = annotation.date.getTime()
      if (t >= startMs && t <= endMs) {
        results.push({ annotation, occurrenceDate: annotation.date, endDate: annotEndDate })
      }
      continue
    }

    const { frequency } = annotation.recurrence

    function step(n: number): Date {
      if (frequency === 'weekly') return addDays(annotation.date, n * 7)
      if (frequency === 'monthly') return addMonthsClamped(annotation.date, n)
      return addMonthsClamped(annotation.date, n * 12)
    }

    // Walk forward from anchor (n=0, 1, 2, …). The anchor date is the start
    // of the recurrence — occurrences before it are not generated.
    let n = 0
    while (true) {
      const d = step(n)
      if (d.getTime() > endMs) break
      if (d.getTime() >= startMs) results.push({ annotation, occurrenceDate: d, endDate: annotEndDate })
      n++
    }
  }

  return results.sort((a, b) => a.occurrenceDate.getTime() - b.occurrenceDate.getTime())
}
