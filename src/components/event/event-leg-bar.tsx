import * as React from 'react'
import type { Category } from '~/db/schema'

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

type BarLeg = {
  categoryId: string | null
  category: Category | null
  unitCount: bigint
}

// ─── Component ────────────────────────────────────────────────────────────────

export function EventLegBar({ legs, categories }: { legs: BarLeg[]; categories: Category[] }) {
  const [hoveredIdx, setHoveredIdx] = React.useState<number | null>(null)

  const colorMap = React.useMemo(() => buildCategoryColorMap(categories), [categories])

  if (legs.length === 0) return null

  const x = legs.length
  const keyOrder: string[] = []
  const groups = new Map<string, { count: number; color: string; label: string }>()

  for (const leg of legs) {
    const key = leg.categoryId ?? '__none__'
    if (!groups.has(key)) {
      keyOrder.push(key)
      groups.set(key, {
        count: 0,
        color: leg.categoryId ? (colorMap.get(leg.categoryId) ?? UNCATEGORIZED_COLOR) : UNCATEGORIZED_COLOR,
        label: leg.category?.name ?? 'Uncategorized',
      })
    }
    groups.get(key)!.count++
  }

  let cumCount = 0
  const segs = keyOrder.map((key) => {
    const g = groups.get(key)!
    const centerPct = ((cumCount + g.count / 2) / x) * 100
    cumCount += g.count
    return { key, count: g.count, color: g.color, label: g.label, centerPct }
  })

  const hovered = hoveredIdx !== null ? (segs[hoveredIdx] ?? null) : null

  return (
    <div className="relative mt-1.5 py-2 -my-2" onMouseLeave={() => setHoveredIdx(null)}>
      <div
        className="h-[5px] rounded-full overflow-hidden"
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${x}, 1fr)`,
          columnGap: '1.5px',
        }}
      >
        {segs.map((seg, i) => (
          <div
            key={seg.key}
            style={{ gridColumn: `span ${seg.count}`, backgroundColor: seg.color }}
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
