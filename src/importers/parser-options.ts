/**
 * Parser options for the Import Wizard dropdown.
 *
 * Pure data only — safe to import in the browser. The actual parser
 * implementations (and pdfjs) live behind the server-side `pdf-registry`.
 */

export type ParserId = 'canonical' | 'amex-pdf' | 'commbank-pdf' | 'vanguard-pdf'

export interface ParserOption {
  id: ParserId
  label: string
  description: string
  /** `accept` attribute for the file input. */
  accept: string
  /** `canonical` parses in the browser; `pdf` is parsed + stored server-side. */
  kind: 'canonical' | 'pdf'
}

export const PARSER_OPTIONS: ParserOption[] = [
  {
    id: 'canonical',
    label: 'Canonical CSV',
    description: 'A CSV already in the canonical event/leg format.',
    accept: '.csv,text/csv',
    kind: 'canonical',
  },
  {
    id: 'amex-pdf',
    label: 'Amex statement (PDF)',
    description: 'American Express PDF statement. The file must be named YYYY-MM-DD.pdf (statement closing date).',
    accept: '.pdf,application/pdf',
    kind: 'pdf',
  },
  {
    id: 'commbank-pdf',
    label: 'CommBank statement (PDF)',
    description: 'Commonwealth Bank PDF statement.',
    accept: '.pdf,application/pdf',
    kind: 'pdf',
  },
  {
    id: 'vanguard-pdf',
    label: 'Vanguard statement (PDF)',
    description: 'Vanguard Personal Investor PDF statement.',
    accept: '.pdf,application/pdf',
    kind: 'pdf',
  },
]

export const DEFAULT_PARSER_ID: ParserId = 'canonical'

const LABEL_BY_ID: Record<string, string> = Object.fromEntries(
  PARSER_OPTIONS.map((o) => [o.id, o.label]),
)

/** Human-readable label for a stored `parserId` (used on the import detail page). */
export function parserLabel(id: string | null | undefined): string {
  if (!id) return '—'
  return LABEL_BY_ID[id] ?? id
}
