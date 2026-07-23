/**
 * Account-based chart color palette: each account gets one base hue, and
 * every instrument belonging to that account is a distinct shade of that hue.
 * Shared between the chart components (Tailwind class lookups via
 * COLOR_CLASSES in line-area-chart.tsx) and the DB schema (accounts.color).
 */

/** Base hues, one per account. Cycled by account index when an account has no explicit color. */
export const ACCOUNT_COLORS = [
  'blue',
  'emerald',
  'amber',
  'rose',
  'violet',
  'cyan',
  'orange',
  'fuchsia',
] as const

export type AccountColorName = (typeof ACCOUNT_COLORS)[number]

/** Each account's instruments cycle through this many shades of its hue. */
export const SHADES_PER_COLOR = 5

/** A concrete chart color: one hue + one shade index. */
export type ChartColor = `${AccountColorName}-${0 | 1 | 2 | 3 | 4}`

/** account.color, or a hue cycled by the account's position (for "Auto"). */
export function resolveAccountColor(
  account: { color: AccountColorName | null },
  accountIndex: number,
): AccountColorName {
  return account.color ?? ACCOUNT_COLORS[accountIndex % ACCOUNT_COLORS.length]
}

export function chartColorFor(accountColor: AccountColorName, shadeIndex: number): ChartColor {
  return `${accountColor}-${(shadeIndex % SHADES_PER_COLOR) as 0 | 1 | 2 | 3 | 4}` as ChartColor
}

// Each account hue gets 5 shades (light shade N -> dark shade N-100), so
// distinct instruments within an account are visually related but distinguishable.
export const COLOR_CLASSES = {
  'blue-0': {
    line: 'stroke-blue-400 dark:stroke-blue-300',
    dot: 'fill-blue-400 dark:fill-blue-300',
    bg: 'bg-blue-400 dark:bg-blue-300',
  },
  'blue-1': {
    line: 'stroke-blue-500 dark:stroke-blue-400',
    dot: 'fill-blue-500 dark:fill-blue-400',
    bg: 'bg-blue-500 dark:bg-blue-400',
  },
  'blue-2': {
    line: 'stroke-blue-600 dark:stroke-blue-500',
    dot: 'fill-blue-600 dark:fill-blue-500',
    bg: 'bg-blue-600 dark:bg-blue-500',
  },
  'blue-3': {
    line: 'stroke-blue-700 dark:stroke-blue-600',
    dot: 'fill-blue-700 dark:fill-blue-600',
    bg: 'bg-blue-700 dark:bg-blue-600',
  },
  'blue-4': {
    line: 'stroke-blue-800 dark:stroke-blue-700',
    dot: 'fill-blue-800 dark:fill-blue-700',
    bg: 'bg-blue-800 dark:bg-blue-700',
  },

  'emerald-0': {
    line: 'stroke-emerald-400 dark:stroke-emerald-300',
    dot: 'fill-emerald-400 dark:fill-emerald-300',
    bg: 'bg-emerald-400 dark:bg-emerald-300',
  },
  'emerald-1': {
    line: 'stroke-emerald-500 dark:stroke-emerald-400',
    dot: 'fill-emerald-500 dark:fill-emerald-400',
    bg: 'bg-emerald-500 dark:bg-emerald-400',
  },
  'emerald-2': {
    line: 'stroke-emerald-600 dark:stroke-emerald-500',
    dot: 'fill-emerald-600 dark:fill-emerald-500',
    bg: 'bg-emerald-600 dark:bg-emerald-500',
  },
  'emerald-3': {
    line: 'stroke-emerald-700 dark:stroke-emerald-600',
    dot: 'fill-emerald-700 dark:fill-emerald-600',
    bg: 'bg-emerald-700 dark:bg-emerald-600',
  },
  'emerald-4': {
    line: 'stroke-emerald-800 dark:stroke-emerald-700',
    dot: 'fill-emerald-800 dark:fill-emerald-700',
    bg: 'bg-emerald-800 dark:bg-emerald-700',
  },

  'amber-0': {
    line: 'stroke-amber-400 dark:stroke-amber-300',
    dot: 'fill-amber-400 dark:fill-amber-300',
    bg: 'bg-amber-400 dark:bg-amber-300',
  },
  'amber-1': {
    line: 'stroke-amber-500 dark:stroke-amber-400',
    dot: 'fill-amber-500 dark:fill-amber-400',
    bg: 'bg-amber-500 dark:bg-amber-400',
  },
  'amber-2': {
    line: 'stroke-amber-600 dark:stroke-amber-500',
    dot: 'fill-amber-600 dark:fill-amber-500',
    bg: 'bg-amber-600 dark:bg-amber-500',
  },
  'amber-3': {
    line: 'stroke-amber-700 dark:stroke-amber-600',
    dot: 'fill-amber-700 dark:fill-amber-600',
    bg: 'bg-amber-700 dark:bg-amber-600',
  },
  'amber-4': {
    line: 'stroke-amber-800 dark:stroke-amber-700',
    dot: 'fill-amber-800 dark:fill-amber-700',
    bg: 'bg-amber-800 dark:bg-amber-700',
  },

  'rose-0': {
    line: 'stroke-rose-400 dark:stroke-rose-300',
    dot: 'fill-rose-400 dark:fill-rose-300',
    bg: 'bg-rose-400 dark:bg-rose-300',
  },
  'rose-1': {
    line: 'stroke-rose-500 dark:stroke-rose-400',
    dot: 'fill-rose-500 dark:fill-rose-400',
    bg: 'bg-rose-500 dark:bg-rose-400',
  },
  'rose-2': {
    line: 'stroke-rose-600 dark:stroke-rose-500',
    dot: 'fill-rose-600 dark:fill-rose-500',
    bg: 'bg-rose-600 dark:bg-rose-500',
  },
  'rose-3': {
    line: 'stroke-rose-700 dark:stroke-rose-600',
    dot: 'fill-rose-700 dark:fill-rose-600',
    bg: 'bg-rose-700 dark:bg-rose-600',
  },
  'rose-4': {
    line: 'stroke-rose-800 dark:stroke-rose-700',
    dot: 'fill-rose-800 dark:fill-rose-700',
    bg: 'bg-rose-800 dark:bg-rose-700',
  },

  'violet-0': {
    line: 'stroke-violet-400 dark:stroke-violet-300',
    dot: 'fill-violet-400 dark:fill-violet-300',
    bg: 'bg-violet-400 dark:bg-violet-300',
  },
  'violet-1': {
    line: 'stroke-violet-500 dark:stroke-violet-400',
    dot: 'fill-violet-500 dark:fill-violet-400',
    bg: 'bg-violet-500 dark:bg-violet-400',
  },
  'violet-2': {
    line: 'stroke-violet-600 dark:stroke-violet-500',
    dot: 'fill-violet-600 dark:fill-violet-500',
    bg: 'bg-violet-600 dark:bg-violet-500',
  },
  'violet-3': {
    line: 'stroke-violet-700 dark:stroke-violet-600',
    dot: 'fill-violet-700 dark:fill-violet-600',
    bg: 'bg-violet-700 dark:bg-violet-600',
  },
  'violet-4': {
    line: 'stroke-violet-800 dark:stroke-violet-700',
    dot: 'fill-violet-800 dark:fill-violet-700',
    bg: 'bg-violet-800 dark:bg-violet-700',
  },

  'cyan-0': {
    line: 'stroke-cyan-400 dark:stroke-cyan-300',
    dot: 'fill-cyan-400 dark:fill-cyan-300',
    bg: 'bg-cyan-400 dark:bg-cyan-300',
  },
  'cyan-1': {
    line: 'stroke-cyan-500 dark:stroke-cyan-400',
    dot: 'fill-cyan-500 dark:fill-cyan-400',
    bg: 'bg-cyan-500 dark:bg-cyan-400',
  },
  'cyan-2': {
    line: 'stroke-cyan-600 dark:stroke-cyan-500',
    dot: 'fill-cyan-600 dark:fill-cyan-500',
    bg: 'bg-cyan-600 dark:bg-cyan-500',
  },
  'cyan-3': {
    line: 'stroke-cyan-700 dark:stroke-cyan-600',
    dot: 'fill-cyan-700 dark:fill-cyan-600',
    bg: 'bg-cyan-700 dark:bg-cyan-600',
  },
  'cyan-4': {
    line: 'stroke-cyan-800 dark:stroke-cyan-700',
    dot: 'fill-cyan-800 dark:fill-cyan-700',
    bg: 'bg-cyan-800 dark:bg-cyan-700',
  },

  'orange-0': {
    line: 'stroke-orange-400 dark:stroke-orange-300',
    dot: 'fill-orange-400 dark:fill-orange-300',
    bg: 'bg-orange-400 dark:bg-orange-300',
  },
  'orange-1': {
    line: 'stroke-orange-500 dark:stroke-orange-400',
    dot: 'fill-orange-500 dark:fill-orange-400',
    bg: 'bg-orange-500 dark:bg-orange-400',
  },
  'orange-2': {
    line: 'stroke-orange-600 dark:stroke-orange-500',
    dot: 'fill-orange-600 dark:fill-orange-500',
    bg: 'bg-orange-600 dark:bg-orange-500',
  },
  'orange-3': {
    line: 'stroke-orange-700 dark:stroke-orange-600',
    dot: 'fill-orange-700 dark:fill-orange-600',
    bg: 'bg-orange-700 dark:bg-orange-600',
  },
  'orange-4': {
    line: 'stroke-orange-800 dark:stroke-orange-700',
    dot: 'fill-orange-800 dark:fill-orange-700',
    bg: 'bg-orange-800 dark:bg-orange-700',
  },

  'fuchsia-0': {
    line: 'stroke-fuchsia-400 dark:stroke-fuchsia-300',
    dot: 'fill-fuchsia-400 dark:fill-fuchsia-300',
    bg: 'bg-fuchsia-400 dark:bg-fuchsia-300',
  },
  'fuchsia-1': {
    line: 'stroke-fuchsia-500 dark:stroke-fuchsia-400',
    dot: 'fill-fuchsia-500 dark:fill-fuchsia-400',
    bg: 'bg-fuchsia-500 dark:bg-fuchsia-400',
  },
  'fuchsia-2': {
    line: 'stroke-fuchsia-600 dark:stroke-fuchsia-500',
    dot: 'fill-fuchsia-600 dark:fill-fuchsia-500',
    bg: 'bg-fuchsia-600 dark:bg-fuchsia-500',
  },
  'fuchsia-3': {
    line: 'stroke-fuchsia-700 dark:stroke-fuchsia-600',
    dot: 'fill-fuchsia-700 dark:fill-fuchsia-600',
    bg: 'bg-fuchsia-700 dark:bg-fuchsia-600',
  },
  'fuchsia-4': {
    line: 'stroke-fuchsia-800 dark:stroke-fuchsia-700',
    dot: 'fill-fuchsia-800 dark:fill-fuchsia-700',
    bg: 'bg-fuchsia-800 dark:bg-fuchsia-700',
  },
} as const satisfies Record<ChartColor, { line: string; dot: string; bg: string }>

/** Default chart color used when a series has no explicit account/instrument color. */
export const DEFAULT_CHART_COLOR: ChartColor = 'blue-2'
