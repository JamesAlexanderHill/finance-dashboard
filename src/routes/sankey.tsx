import * as React from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { ParentSize } from '@visx/responsive'
import { sankeyService, getSession } from '~/db/services'
import type { SankeyData } from '~/db/services'
import { SankeyChart } from '~/components/charts/sankey-chart'

// ─── Server function ──────────────────────────────────────────────────────────

const getData = createServerFn({ method: 'GET' })
  .inputValidator((data: unknown) => data as { depth?: number })
  .handler(async ({ data }) => {
    const session = await getSession()
    if (!session) return { user: null, sankey: null }
    const depth = data.depth ?? 1
    const sankey = await sankeyService.getData(session.ctx, depth)
    return { user: session.user, sankey }
  })

// ─── Route ────────────────────────────────────────────────────────────────────

interface SankeySearch {
  depth?: number
}

export const Route = createFileRoute('/sankey')({
  validateSearch: (search: Record<string, unknown>): SankeySearch => ({
    depth: typeof search.depth === 'number' ? Math.min(4, Math.max(1, search.depth)) : 1,
  }),
  loaderDeps: ({ search }) => ({ depth: search.depth }),
  loader: ({ deps }) => getData({ data: { depth: deps.depth } }),
  component: SankeyPage,
})

// ─── Component ────────────────────────────────────────────────────────────────

const DEPTH_LABELS: Record<number, string> = {
  1: 'Level 1 — top categories',
  2: 'Level 2 — one level deep',
  3: 'Level 3 — two levels deep',
  4: 'Level 4 — three levels deep',
}

function SankeyPage() {
  const { user, sankey } = Route.useLoaderData()
  const { depth = 1 } = Route.useSearch()
  const navigate = Route.useNavigate()

  if (!user) {
    return (
      <div className="text-gray-500 dark:text-gray-400 text-sm">
        No user found. Visit{' '}
        <a href="/dev" className="text-blue-600 dark:text-blue-400 underline">
          Dev Tools
        </a>
        .
      </div>
    )
  }

  const isEmpty = !sankey || sankey.nodes.length === 0

  const fmtAUD = (n: number) =>
    n.toLocaleString('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 })

  return (
    <div className="max-w-5xl">
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">
            Cash Flow
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Sankey diagram showing income → expense flows by category
          </p>
        </div>

        {/* Depth selector */}
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-500 dark:text-gray-400">Depth:</span>
          <div className="flex gap-1">
            {[1, 2, 3, 4].map((d) => (
              <button
                key={d}
                onClick={() => navigate({ search: { depth: d } })}
                title={DEPTH_LABELS[d]}
                className={[
                  'px-3 py-1.5 text-sm rounded-md font-medium transition-colors',
                  depth === d
                    ? 'bg-blue-600 text-white'
                    : 'bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800',
                ].join(' ')}
              >
                {d}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Stats row */}
      {sankey && !isEmpty && (
        <div className="grid grid-cols-3 gap-4 mb-6">
          <StatCard
            label="Total income"
            value={fmtAUD(sankey.totalIncome)}
            color="text-green-600 dark:text-green-400"
          />
          <StatCard
            label="Total expenses"
            value={fmtAUD(sankey.totalExpense)}
            color="text-red-600 dark:text-red-400"
          />
          <StatCard
            label="Net"
            value={fmtAUD(sankey.totalIncome - sankey.totalExpense)}
            color={
              sankey.totalIncome >= sankey.totalExpense
                ? 'text-blue-600 dark:text-blue-400'
                : 'text-red-600 dark:text-red-400'
            }
          />
        </div>
      )}

      {/* Chart */}
      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4">
        {isEmpty ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <p className="text-gray-500 dark:text-gray-400 text-sm">
              No categorized transactions found.
            </p>
            <p className="text-gray-400 dark:text-gray-500 text-xs">
              Assign categories to transaction legs via the Events page to see flows here.
            </p>
          </div>
        ) : (
          <ParentSize>
            {({ width }) => (
              <SankeyChart
                width={width}
                height={Math.max(360, Math.min(600, (sankey?.nodes.length ?? 4) * 60))}
                nodes={sankey!.nodes}
                links={sankey!.links}
              />
            )}
          </ParentSize>
        )}
      </div>

      {/* Depth legend */}
      <p className="mt-3 text-xs text-gray-400 dark:text-gray-500">
        {DEPTH_LABELS[depth]}. Links show how income flows into expense categories.
        Width is proportional to amount.
      </p>
    </div>
  )
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  color,
}: {
  label: string
  value: string
  color: string
}) {
  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4">
      <p className="text-xs text-gray-400 dark:text-gray-500 mb-1">{label}</p>
      <p className={`text-xl font-semibold tabular-nums ${color}`}>{value}</p>
    </div>
  )
}
