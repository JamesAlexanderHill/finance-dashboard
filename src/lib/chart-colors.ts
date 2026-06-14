/**
 * Account-based chart color palette: each account gets one base hue, and
 * every instrument belonging to that account is a distinct shade of that hue.
 * Shared between the chart components (Tailwind class lookups via
 * COLOR_CLASSES in line-area-chart.tsx) and the DB schema (accounts.color).
 */

/** Base hues, one per account. Cycled by account index when an account has no explicit color. */
export const ACCOUNT_COLORS = [
  'blue', 'emerald', 'amber', 'rose', 'violet', 'cyan', 'orange', 'fuchsia',
] as const

export type AccountColorName = (typeof ACCOUNT_COLORS)[number]

/** Each account's instruments cycle through this many shades of its hue. */
export const SHADES_PER_COLOR = 5

/** A concrete chart color: one hue + one shade index. */
export type ChartColor = `${AccountColorName}-${0 | 1 | 2 | 3 | 4}`

/** account.color, or a hue cycled by the account's position (for "Auto"). */
export function resolveAccountColor(account: { color: AccountColorName | null }, accountIndex: number): AccountColorName {
  return account.color ?? ACCOUNT_COLORS[accountIndex % ACCOUNT_COLORS.length]
}

export function chartColorFor(accountColor: AccountColorName, shadeIndex: number): ChartColor {
  return `${accountColor}-${(shadeIndex % SHADES_PER_COLOR) as 0 | 1 | 2 | 3 | 4}` as ChartColor
}
