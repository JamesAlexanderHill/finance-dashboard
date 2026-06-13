/**
 * Canonical set of named chart colors, shared between the chart components
 * (Tailwind class lookups) and the DB schema (instruments.positiveColor /
 * negativeColor / neutralColor enum values).
 */
export const CHART_COLORS = [
  'green', 'emerald', 'teal', 'lime', 'cyan',
  'red', 'rose', 'orange', 'amber', 'pink',
  'gray', 'slate', 'zinc', 'stone',
] as const

export type ChartColorName = (typeof CHART_COLORS)[number]
