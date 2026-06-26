import type { Category } from '~/db/schema'
import type { RequestContext } from '../utils/context'
import type { BalanceHistoryPeriod } from '../query/instrument'
import { queryCategoryLegsByDate } from '../query/category-spending'
import { applyRelationsToLegs } from './relation-netting'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CategoryInfo {
  id: string
  name: string
  isIncome: boolean
}

export interface CategoryBarDatum {
  period: string
  amounts: Record<string, number>
}

export interface CategoryBarData {
  categories: CategoryInfo[]
  data: CategoryBarDatum[]
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function bucketDate(date: Date, period: BalanceHistoryPeriod): string {
  const y = date.getUTCFullYear()
  const m = date.getUTCMonth()
  const d = date.getUTCDate()
  if (period === 'month') {
    return `${y}-${String(m + 1).padStart(2, '0')}-01`
  }
  if (period === 'week') {
    const dow = date.getUTCDay()
    const monday = new Date(Date.UTC(y, m, d - ((dow + 6) % 7)))
    return monday.toISOString().slice(0, 10)
  }
  return new Date(Date.UTC(y, m, d)).toISOString().slice(0, 10)
}

function rootOf(catId: string, catMap: Map<string, Category>): Category | undefined {
  let cat = catMap.get(catId)
  while (cat?.parentId) {
    cat = catMap.get(cat.parentId)
  }
  return cat
}

// ─── Service ──────────────────────────────────────────────────────────────────

async function getByPeriod(
  ctx: RequestContext,
  dateRange: { start: string | null; end: string },
  period: BalanceHistoryPeriod,
): Promise<CategoryBarData> {
  const { categories, legs, relations, childLegs } = await queryCategoryLegsByDate(
    ctx.workspaceId,
    dateRange,
  )
  const nettedLegs = applyRelationsToLegs(legs, relations, childLegs)

  if (!categories.length || !nettedLegs.length) return { categories: [], data: [] }

  const catMap = new Map(categories.map((c) => [c.id, c]))

  // Accumulate amounts per (period bucket, root category id)
  const periodAmounts = new Map<string, Map<string, bigint>>()

  for (const leg of nettedLegs) {
    if (!leg.categoryId) continue
    const root = rootOf(leg.categoryId, catMap)
    if (!root) continue

    const bucket = bucketDate(leg.effectiveAt, period)
    if (!periodAmounts.has(bucket)) periodAmounts.set(bucket, new Map())
    const byCategory = periodAmounts.get(bucket)!
    byCategory.set(root.id, (byCategory.get(root.id) ?? BigInt(0)) + leg.unitCount)
  }

  if (periodAmounts.size === 0) return { categories: [], data: [] }

  // Determine which root categories appear and whether they are income/expense
  const rootTotals = new Map<string, bigint>()
  const rootsSeen = new Map<string, Category>()
  for (const byCategory of periodAmounts.values()) {
    for (const [catId, amount] of byCategory) {
      rootTotals.set(catId, (rootTotals.get(catId) ?? BigInt(0)) + amount)
      const cat = catMap.get(catId)
      if (cat) rootsSeen.set(catId, cat)
    }
  }

  const cats: CategoryInfo[] = [...rootsSeen.values()].map((cat) => ({
    id: cat.id,
    name: cat.name,
    isIncome: (rootTotals.get(cat.id) ?? BigInt(0)) > BigInt(0),
  }))

  // Sort: income categories first, then expense categories
  cats.sort((a, b) => {
    if (a.isIncome !== b.isIncome) return a.isIncome ? -1 : 1
    return a.name.localeCompare(b.name)
  })

  const sortedPeriods = [...periodAmounts.keys()].sort()

  const data: CategoryBarDatum[] = sortedPeriods.map((bucket) => {
    const byCategory = periodAmounts.get(bucket)!
    const amounts: Record<string, number> = {}
    for (const cat of cats) {
      const raw = byCategory.get(cat.id) ?? BigInt(0)
      amounts[cat.id] = Number(raw) / 100
    }
    return { period: bucket, amounts }
  })

  return { categories: cats, data }
}

export const categorySpendingService = { getByPeriod }
