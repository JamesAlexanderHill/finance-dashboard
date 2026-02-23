/**
 * Canonical CSV importer.
 *
 * The canonical format maps directly to Events and Legs. One CSV row = one Leg.
 * Rows sharing the same `eventGroup` are merged into a single Event.
 *
 * Columns:
 *   eventGroup, externalEventId, eventType, effectiveAt, postedAt,
 *   description, instrumentCode, amountMinor, categoryPath
 */

export type EventType =
  | 'purchase'
  | 'transfer'
  | 'exchange'
  | 'trade'
  | 'bill_payment'
  | 'payout'

export interface ParsedLeg {
  instrumentCode: string
  amountMinor: bigint
  categoryPath: string | null
}

export interface ParsedEvent {
  eventGroup: string
  externalEventId: string | null
  eventType: EventType
  effectiveAt: Date
  postedAt: Date
  description: string
  legs: ParsedLeg[]
}

export interface ParseError {
  line: number
  message: string
}

export interface ParseResult {
  events: ParsedEvent[]
  errors: ParseError[]
}

const REQUIRED_COLUMNS = [
  'eventGroup',
  'eventType',
  'effectiveAt',
  'postedAt',
  'description',
  'instrumentCode',
  'amountMinor',
] as const

const VALID_EVENT_TYPES: EventType[] = [
  'purchase',
  'transfer',
  'exchange',
  'trade',
  'bill_payment',
  'payout',
]

/** Parse a canonical finance CSV string into structured events. Runs in the browser. */
export function parseCanonicalCsv(csvContent: string): ParseResult {
  const lines = csvContent.split(/\r?\n/).filter((l) => l.trim() !== '')
  const errors: ParseError[] = []

  if (lines.length === 0) {
    return { events: [], errors: [{ line: 0, message: 'File is empty' }] }
  }

  // ── Parse header ───────────────────────────────────────────────────────────
  const headers = parseCsvRow(lines[0]).map((h) => h.trim())
  for (const col of REQUIRED_COLUMNS) {
    if (!headers.includes(col)) {
      errors.push({ line: 1, message: `Missing required column: ${col}` })
    }
  }
  if (errors.length > 0) return { events: [], errors }

  const idx = (col: string) => headers.indexOf(col)

  // ── Parse rows ─────────────────────────────────────────────────────────────
  // Group rows by eventGroup
  const groups = new Map<
    string,
    Array<{ row: string[]; lineNum: number }>
  >()

  for (let i = 1; i < lines.length; i++) {
    const row = parseCsvRow(lines[i])
    const eventGroup = row[idx('eventGroup')]?.trim()
    if (!eventGroup) {
      errors.push({ line: i + 1, message: 'eventGroup is required' })
      continue
    }
    if (!groups.has(eventGroup)) groups.set(eventGroup, [])
    groups.get(eventGroup)!.push({ row, lineNum: i + 1 })
  }

  // ── Build events ───────────────────────────────────────────────────────────
  const parsedEvents: ParsedEvent[] = []

  for (const [eventGroup, rowObjs] of groups) {
    const firstRow = rowObjs[0].row
    const firstLine = rowObjs[0].lineNum

    // Validate event-level field consistency across rows in the group
    const eventFields = [
      'externalEventId',
      'eventType',
      'effectiveAt',
      'postedAt',
      'description',
    ] as const
    let groupHasError = false

    for (const field of eventFields) {
      const fi = idx(field)
      if (fi === -1) continue
      const firstVal = firstRow[fi]?.trim() ?? ''
      for (const { row, lineNum } of rowObjs.slice(1)) {
        const val = row[fi]?.trim() ?? ''
        if (val !== firstVal) {
          errors.push({
            line: lineNum,
            message: `eventGroup "${eventGroup}": conflicting value for "${field}" (expected "${firstVal}", got "${val}")`,
          })
          groupHasError = true
        }
      }
    }
    if (groupHasError) continue

    // Parse event-level fields from the first row
    const eventType = firstRow[idx('eventType')]?.trim()
    if (!VALID_EVENT_TYPES.includes(eventType as EventType)) {
      errors.push({
        line: firstLine,
        message: `Invalid eventType "${eventType}". Must be one of: ${VALID_EVENT_TYPES.join(', ')}`,
      })
      continue
    }

    const effectiveAtRaw = firstRow[idx('effectiveAt')]?.trim()
    const postedAtRaw = firstRow[idx('postedAt')]?.trim()
    const effectiveAt = parseDate(effectiveAtRaw)
    const postedAt = parseDate(postedAtRaw)

    if (!effectiveAt) {
      errors.push({ line: firstLine, message: `Invalid effectiveAt date: "${effectiveAtRaw}"` })
      continue
    }
    if (!postedAt) {
      errors.push({ line: firstLine, message: `Invalid postedAt date: "${postedAtRaw}"` })
      continue
    }

    const description = firstRow[idx('description')]?.trim() ?? ''
    const externalEventId = firstRow[idx('externalEventId')]?.trim() || null

    // Parse legs from all rows in the group
    const legs: ParsedLeg[] = []
    let legError = false

    for (const { row, lineNum } of rowObjs) {
      const instrumentCode = row[idx('instrumentCode')]?.trim()
      if (!instrumentCode) {
        errors.push({ line: lineNum, message: 'instrumentCode is required' })
        legError = true
        continue
      }
      const amountMinorRaw = row[idx('amountMinor')]?.trim()
      if (!amountMinorRaw || isNaN(Number(amountMinorRaw))) {
        errors.push({ line: lineNum, message: `Invalid amountMinor: "${amountMinorRaw}"` })
        legError = true
        continue
      }
      const categoryPath = row[idx('categoryPath')]?.trim() || null

      legs.push({
        instrumentCode,
        amountMinor: BigInt(amountMinorRaw),
        categoryPath,
      })
    }

    if (legError) continue

    parsedEvents.push({
      eventGroup,
      externalEventId,
      eventType: eventType as EventType,
      effectiveAt,
      postedAt,
      description,
      legs,
    })
  }

  return { events: parsedEvents, errors }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Parse a single CSV row respecting double-quoted fields. */
function parseCsvRow(line: string): string[] {
  const result: string[] = []
  let cur = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"'
        i++
      } else {
        inQuotes = !inQuotes
      }
    } else if (ch === ',' && !inQuotes) {
      result.push(cur)
      cur = ''
    } else {
      cur += ch
    }
  }
  result.push(cur)
  return result
}

/** Parse a date string (YYYY-MM-DD or ISO 8601). Returns null if invalid. */
function parseDate(raw: string): Date | null {
  if (!raw) return null
  const d = new Date(raw)
  return isNaN(d.getTime()) ? null : d
}
