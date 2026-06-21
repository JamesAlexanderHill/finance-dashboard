import * as React from 'react'
import { ParentSize } from '@visx/responsive'
import { scaleBand, scaleLinear } from '@visx/scale'
import { AxisBottom, AxisLeft } from '@visx/axis'
import { GridRows } from '@visx/grid'
import { useTooltip, TooltipWithBounds } from '@visx/tooltip'
import { localPoint } from '@visx/event'
import { MARGIN } from './line-area-chart'
import type { CategoryInfo, CategoryBarDatum } from '~/db/services'

// ─── Types ────────────────────────────────────────────────────────────────────

export type { CategoryInfo, CategoryBarDatum }

export type CategoryBarChartProps = {
  categories: CategoryInfo[]
  data: CategoryBarDatum[]
  height?: number
  tickFormat?: (period: string) => string
  yTickFormat?: (value: number) => string
  renderTooltip?: (datum: CategoryBarDatum) => React.ReactNode
}

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

export function buildCategoryColorMap(categories: CategoryInfo[]): Map<string, string> {
  const colorMap = new Map<string, string>()
  categories.forEach((cat, i) => {
    colorMap.set(cat.id, PALETTE[i % PALETTE.length])
  })
  return colorMap
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function CategoryBarChart({ height = 200, ...props }: CategoryBarChartProps) {
  if (props.data.length === 0) return null
  return (
    <div style={{ height }}>
      <ParentSize>
        {({ width }) => (width > 0 ? <Chart {...props} width={width} height={height} /> : null)}
      </ParentSize>
    </div>
  )
}

// ─── Inner chart ──────────────────────────────────────────────────────────────

function Chart({
  categories,
  data,
  width,
  height,
  tickFormat,
  yTickFormat,
  renderTooltip,
}: CategoryBarChartProps & { width: number; height: number }) {
  const colorMap = React.useMemo(() => buildCategoryColorMap(categories), [categories])

  const { showTooltip, hideTooltip, tooltipData, tooltipLeft, tooltipTop, tooltipOpen } =
    useTooltip<CategoryBarDatum>()

  const xScale = React.useMemo(
    () =>
      scaleBand<string>({
        domain: data.map((d) => d.period),
        range: [MARGIN.left, width - MARGIN.right],
        padding: data.length > 20 ? 0.05 : 0.25,
      }),
    [data, width],
  )

  const yMax = React.useMemo(() => {
    let max = 0
    for (const d of data) {
      let sum = 0
      for (const cat of categories) {
        sum += Math.abs(d.amounts[cat.id] ?? 0)
      }
      if (sum > max) max = sum
    }
    return max
  }, [data, categories])

  const pad = yMax * 0.1 || 1
  const yScale = React.useMemo(
    () =>
      scaleLinear<number>({
        domain: [0, yMax + pad],
        range: [height - MARGIN.bottom, MARGIN.top],
      }),
    [yMax, pad, height],
  )

  const bw = xScale.bandwidth()

  const NUM_X_TICKS = Math.min(data.length, Math.floor((width - MARGIN.left - MARGIN.right) / 48))

  function handleMouseMove(event: React.MouseEvent, datum: CategoryBarDatum) {
    const point = localPoint(event)
    if (!point) return
    showTooltip({ tooltipData: datum, tooltipLeft: point.x, tooltipTop: point.y })
  }

  return (
    <div className="relative">
      <svg width={width} height={height}>
        <GridRows
          scale={yScale}
          width={Math.max(width - MARGIN.left - MARGIN.right, 0)}
          left={MARGIN.left}
          numTicks={4}
          className="stroke-gray-100 dark:stroke-gray-800"
        />

        {data.map((d) => {
          const x = xScale(d.period) ?? 0
          const bars: React.ReactNode[] = []

          let cumulative = 0
          for (const cat of categories) {
            const v = Math.abs(d.amounts[cat.id] ?? 0)
            if (v === 0) continue
            const y1 = yScale(cumulative + v)
            const y0 = yScale(cumulative)
            cumulative += v
            bars.push(
              <rect
                key={cat.id}
                x={x}
                y={y1}
                width={Math.max(0, bw)}
                height={Math.max(0, y0 - y1)}
                fill={colorMap.get(cat.id) ?? '#888'}
                fillOpacity={0.85}
                rx={1}
              />,
            )
          }

          return (
            <g
              key={d.period}
              onMouseMove={(e) => handleMouseMove(e, d)}
              onMouseLeave={hideTooltip}
              style={{ cursor: 'default' }}
            >
              {/* Invisible hover target spanning full bar height */}
              <rect
                x={x}
                y={MARGIN.top}
                width={Math.max(0, bw)}
                height={Math.max(0, height - MARGIN.top - MARGIN.bottom)}
                fill="transparent"
              />
              {bars}
            </g>
          )
        })}

        <AxisBottom
          top={height - MARGIN.bottom}
          scale={xScale}
          numTicks={NUM_X_TICKS}
          tickFormat={(value) => (tickFormat ? tickFormat(value) : value)}
          stroke="transparent"
          tickStroke="transparent"
          tickLabelProps={(_value, index, ticks) => ({
            className: 'fill-gray-500 dark:fill-gray-400',
            fontSize: 10,
            textAnchor: (
              index === 0 ? 'start' : index === ticks.length - 1 ? 'end' : 'middle'
            ) as 'start' | 'end' | 'middle',
          })}
        />
        <AxisLeft
          left={MARGIN.left}
          scale={yScale}
          numTicks={4}
          tickFormat={(value) => (yTickFormat ? yTickFormat(value as number) : String(value))}
          stroke="transparent"
          tickStroke="transparent"
          tickLabelProps={() => ({
            className: 'fill-gray-500 dark:fill-gray-400',
            fontSize: 10,
            textAnchor: 'end' as const,
            dx: -8,
            dy: 3,
          })}
        />
      </svg>

      {tooltipOpen && tooltipData && renderTooltip && (
        <TooltipWithBounds
          left={tooltipLeft}
          top={tooltipTop}
          style={{
            position: 'absolute',
            backgroundColor: 'transparent',
            padding: 0,
            border: 'none',
            boxShadow: 'none',
            borderRadius: 0,
            pointerEvents: 'none',
          }}
        >
          <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-md shadow-lg px-2 py-1 text-xs text-gray-900 dark:text-gray-100 whitespace-nowrap">
            {renderTooltip(tooltipData)}
          </div>
        </TooltipWithBounds>
      )}
    </div>
  )
}
