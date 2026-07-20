import * as React from 'react'
import type { Category } from '~/db/schema'
import { resolveEventCategoryBreakdown, type RollupEvent } from '~/db/services/service/category-rollup'

// ─── Colors ───────────────────────────────────────────────────────────────────

const PALETTE = [
  '#3b82f6', // blue-500
  '#22c55e', // green-500
  '#f59e0b', // amber-500
  '#8b5cf6', // violet-500
  '#ec4899', // pink-500
  '#14b8a6', // teal-500
  '#f97316', // orange-500
  '#06b6d4', // cyan-500
  '#a855f7', // purple-500
  '#ef4444', // red-500
]

const UNCATEGORIZED_COLOR = '#d1d5db'

// Assign each category a unique color based on its stable sorted position.
export function buildCategoryColorMap(categories: Category[]): Map<string, string> {
  const sorted = [...categories].sort((a, b) => a.id.localeCompare(b.id))
  return new Map(sorted.map((cat, i) => [cat.id, PALETTE[i % PALETTE.length]]))
}

// ─── Types ────────────────────────────────────────────────────────────────────

type BarLeg = RollupEvent['legs'][number]

// ─── Component ────────────────────────────────────────────────────────────────

export function EventLegBar({
  legs,
  categories,
  childEvents,
}: {
  legs: BarLeg[]
  categories: Category[]
  /** Linked sub-events, consulted only when `legs` are entirely uncategorized. */
  childEvents?: RollupEvent[]
}) {
  const [hoveredIdx, setHoveredIdx] = React.useState<number | null>(null)

  const colorMap = React.useMemo(() => buildCategoryColorMap(categories), [categories])
  const categoryMap = React.useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories])

  if (legs.length === 0) return null

  const shares = resolveEventCategoryBreakdown({ legs }, childEvents)
  const total = shares.reduce((sum, s) => sum + (s.amount < 0n ? -s.amount : s.amount), 0n)
  if (total === 0n) return null

  const keyOrder: string[] = []
  const groups = new Map<string, { amount: bigint; color: string; label: string }>()

  for (const share of shares) {
    const key = share.categoryId ?? '__none__'
    if (!groups.has(key)) {
      keyOrder.push(key)
      groups.set(key, {
        amount: 0n,
        color: share.categoryId ? (colorMap.get(share.categoryId) ?? UNCATEGORIZED_COLOR) : UNCATEGORIZED_COLOR,
        label: share.categoryId ? (categoryMap.get(share.categoryId)?.name ?? 'Uncategorized') : 'Uncategorized',
      })
    }
    const abs = share.amount < 0n ? -share.amount : share.amount
    groups.get(key)!.amount += abs
  }

  const totalNum = Number(total)
  let cumPct = 0
  const segs = keyOrder.map((key) => {
    const g = groups.get(key)!
    const widthPct = (Number(g.amount) / totalNum) * 100
    const centerPct = cumPct + widthPct / 2
    cumPct += widthPct
    return { key, widthPct, color: g.color, label: g.label, centerPct }
  })

  const hovered = hoveredIdx !== null ? (segs[hoveredIdx] ?? null) : null

  return (
    <div className="relative mt-1.5 py-2 -my-2" onMouseLeave={() => setHoveredIdx(null)}>
      <div className="h-[5px] rounded-full overflow-hidden flex gap-[1.5px]">
        {segs.map((seg, i) => (
          <div
            key={seg.key}
            style={{ width: `${seg.widthPct}%`, backgroundColor: seg.color }}
            className="h-full cursor-default"
            onMouseEnter={() => setHoveredIdx(i)}
          />
        ))}
      </div>

      {hovered && (
        <div
          className="absolute bottom-full mb-1 pointer-events-none z-50"
          style={{ left: `${hovered.centerPct}%`, transform: 'translateX(-50%)' }}
        >
          <div className="flex items-center gap-1.5 bg-gray-900 dark:bg-gray-700 text-white text-[11px] leading-none px-2 py-1.5 rounded-md shadow-lg whitespace-nowrap">
            <span
              className="inline-block size-2 rounded-full shrink-0"
              style={{ backgroundColor: hovered.color }}
            />
            {hovered.label}
          </div>
          <div className="flex justify-center -mt-px">
            <div className="w-0 h-0 border-x-[4px] border-t-[4px] border-x-transparent border-t-gray-900 dark:border-t-gray-700" />
          </div>
        </div>
      )}
    </div>
  )
}
