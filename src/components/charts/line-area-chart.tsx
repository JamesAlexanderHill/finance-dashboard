import * as React from 'react'
import { ParentSize } from '@visx/responsive'
import { scaleLinear, scaleTime } from '@visx/scale'
import { LinePath, Line, Bar } from '@visx/shape'
import { AxisBottom, AxisLeft } from '@visx/axis'
import { GridRows } from '@visx/grid'
import { useTooltip, TooltipWithBounds } from '@visx/tooltip'
import { localPoint } from '@visx/event'
import { curveMonotoneX } from '@visx/curve'
import type { CurveFactory } from '@visx/vendor/d3-shape'
import type { ChartColor } from '~/lib/chart-colors'

export const MARGIN = { top: 8, right: 8, bottom: 20, left: 44 }

// Each account hue gets 5 shades (light shade N -> dark shade N-100), so
// distinct instruments within an account are visually related but distinguishable.
export const COLOR_CLASSES = {
  'blue-0': { line: 'stroke-blue-400 dark:stroke-blue-300', dot: 'fill-blue-400 dark:fill-blue-300', bg: 'bg-blue-400 dark:bg-blue-300' },
  'blue-1': { line: 'stroke-blue-500 dark:stroke-blue-400', dot: 'fill-blue-500 dark:fill-blue-400', bg: 'bg-blue-500 dark:bg-blue-400' },
  'blue-2': { line: 'stroke-blue-600 dark:stroke-blue-500', dot: 'fill-blue-600 dark:fill-blue-500', bg: 'bg-blue-600 dark:bg-blue-500' },
  'blue-3': { line: 'stroke-blue-700 dark:stroke-blue-600', dot: 'fill-blue-700 dark:fill-blue-600', bg: 'bg-blue-700 dark:bg-blue-600' },
  'blue-4': { line: 'stroke-blue-800 dark:stroke-blue-700', dot: 'fill-blue-800 dark:fill-blue-700', bg: 'bg-blue-800 dark:bg-blue-700' },

  'emerald-0': { line: 'stroke-emerald-400 dark:stroke-emerald-300', dot: 'fill-emerald-400 dark:fill-emerald-300', bg: 'bg-emerald-400 dark:bg-emerald-300' },
  'emerald-1': { line: 'stroke-emerald-500 dark:stroke-emerald-400', dot: 'fill-emerald-500 dark:fill-emerald-400', bg: 'bg-emerald-500 dark:bg-emerald-400' },
  'emerald-2': { line: 'stroke-emerald-600 dark:stroke-emerald-500', dot: 'fill-emerald-600 dark:fill-emerald-500', bg: 'bg-emerald-600 dark:bg-emerald-500' },
  'emerald-3': { line: 'stroke-emerald-700 dark:stroke-emerald-600', dot: 'fill-emerald-700 dark:fill-emerald-600', bg: 'bg-emerald-700 dark:bg-emerald-600' },
  'emerald-4': { line: 'stroke-emerald-800 dark:stroke-emerald-700', dot: 'fill-emerald-800 dark:fill-emerald-700', bg: 'bg-emerald-800 dark:bg-emerald-700' },

  'amber-0': { line: 'stroke-amber-400 dark:stroke-amber-300', dot: 'fill-amber-400 dark:fill-amber-300', bg: 'bg-amber-400 dark:bg-amber-300' },
  'amber-1': { line: 'stroke-amber-500 dark:stroke-amber-400', dot: 'fill-amber-500 dark:fill-amber-400', bg: 'bg-amber-500 dark:bg-amber-400' },
  'amber-2': { line: 'stroke-amber-600 dark:stroke-amber-500', dot: 'fill-amber-600 dark:fill-amber-500', bg: 'bg-amber-600 dark:bg-amber-500' },
  'amber-3': { line: 'stroke-amber-700 dark:stroke-amber-600', dot: 'fill-amber-700 dark:fill-amber-600', bg: 'bg-amber-700 dark:bg-amber-600' },
  'amber-4': { line: 'stroke-amber-800 dark:stroke-amber-700', dot: 'fill-amber-800 dark:fill-amber-700', bg: 'bg-amber-800 dark:bg-amber-700' },

  'rose-0': { line: 'stroke-rose-400 dark:stroke-rose-300', dot: 'fill-rose-400 dark:fill-rose-300', bg: 'bg-rose-400 dark:bg-rose-300' },
  'rose-1': { line: 'stroke-rose-500 dark:stroke-rose-400', dot: 'fill-rose-500 dark:fill-rose-400', bg: 'bg-rose-500 dark:bg-rose-400' },
  'rose-2': { line: 'stroke-rose-600 dark:stroke-rose-500', dot: 'fill-rose-600 dark:fill-rose-500', bg: 'bg-rose-600 dark:bg-rose-500' },
  'rose-3': { line: 'stroke-rose-700 dark:stroke-rose-600', dot: 'fill-rose-700 dark:fill-rose-600', bg: 'bg-rose-700 dark:bg-rose-600' },
  'rose-4': { line: 'stroke-rose-800 dark:stroke-rose-700', dot: 'fill-rose-800 dark:fill-rose-700', bg: 'bg-rose-800 dark:bg-rose-700' },

  'violet-0': { line: 'stroke-violet-400 dark:stroke-violet-300', dot: 'fill-violet-400 dark:fill-violet-300', bg: 'bg-violet-400 dark:bg-violet-300' },
  'violet-1': { line: 'stroke-violet-500 dark:stroke-violet-400', dot: 'fill-violet-500 dark:fill-violet-400', bg: 'bg-violet-500 dark:bg-violet-400' },
  'violet-2': { line: 'stroke-violet-600 dark:stroke-violet-500', dot: 'fill-violet-600 dark:fill-violet-500', bg: 'bg-violet-600 dark:bg-violet-500' },
  'violet-3': { line: 'stroke-violet-700 dark:stroke-violet-600', dot: 'fill-violet-700 dark:fill-violet-600', bg: 'bg-violet-700 dark:bg-violet-600' },
  'violet-4': { line: 'stroke-violet-800 dark:stroke-violet-700', dot: 'fill-violet-800 dark:fill-violet-700', bg: 'bg-violet-800 dark:bg-violet-700' },

  'cyan-0': { line: 'stroke-cyan-400 dark:stroke-cyan-300', dot: 'fill-cyan-400 dark:fill-cyan-300', bg: 'bg-cyan-400 dark:bg-cyan-300' },
  'cyan-1': { line: 'stroke-cyan-500 dark:stroke-cyan-400', dot: 'fill-cyan-500 dark:fill-cyan-400', bg: 'bg-cyan-500 dark:bg-cyan-400' },
  'cyan-2': { line: 'stroke-cyan-600 dark:stroke-cyan-500', dot: 'fill-cyan-600 dark:fill-cyan-500', bg: 'bg-cyan-600 dark:bg-cyan-500' },
  'cyan-3': { line: 'stroke-cyan-700 dark:stroke-cyan-600', dot: 'fill-cyan-700 dark:fill-cyan-600', bg: 'bg-cyan-700 dark:bg-cyan-600' },
  'cyan-4': { line: 'stroke-cyan-800 dark:stroke-cyan-700', dot: 'fill-cyan-800 dark:fill-cyan-700', bg: 'bg-cyan-800 dark:bg-cyan-700' },

  'orange-0': { line: 'stroke-orange-400 dark:stroke-orange-300', dot: 'fill-orange-400 dark:fill-orange-300', bg: 'bg-orange-400 dark:bg-orange-300' },
  'orange-1': { line: 'stroke-orange-500 dark:stroke-orange-400', dot: 'fill-orange-500 dark:fill-orange-400', bg: 'bg-orange-500 dark:bg-orange-400' },
  'orange-2': { line: 'stroke-orange-600 dark:stroke-orange-500', dot: 'fill-orange-600 dark:fill-orange-500', bg: 'bg-orange-600 dark:bg-orange-500' },
  'orange-3': { line: 'stroke-orange-700 dark:stroke-orange-600', dot: 'fill-orange-700 dark:fill-orange-600', bg: 'bg-orange-700 dark:bg-orange-600' },
  'orange-4': { line: 'stroke-orange-800 dark:stroke-orange-700', dot: 'fill-orange-800 dark:fill-orange-700', bg: 'bg-orange-800 dark:bg-orange-700' },

  'fuchsia-0': { line: 'stroke-fuchsia-400 dark:stroke-fuchsia-300', dot: 'fill-fuchsia-400 dark:fill-fuchsia-300', bg: 'bg-fuchsia-400 dark:bg-fuchsia-300' },
  'fuchsia-1': { line: 'stroke-fuchsia-500 dark:stroke-fuchsia-400', dot: 'fill-fuchsia-500 dark:fill-fuchsia-400', bg: 'bg-fuchsia-500 dark:bg-fuchsia-400' },
  'fuchsia-2': { line: 'stroke-fuchsia-600 dark:stroke-fuchsia-500', dot: 'fill-fuchsia-600 dark:fill-fuchsia-500', bg: 'bg-fuchsia-600 dark:bg-fuchsia-500' },
  'fuchsia-3': { line: 'stroke-fuchsia-700 dark:stroke-fuchsia-600', dot: 'fill-fuchsia-700 dark:fill-fuchsia-600', bg: 'bg-fuchsia-700 dark:bg-fuchsia-600' },
  'fuchsia-4': { line: 'stroke-fuchsia-800 dark:stroke-fuchsia-700', dot: 'fill-fuchsia-800 dark:fill-fuchsia-700', bg: 'bg-fuchsia-800 dark:bg-fuchsia-700' },
} as const satisfies Record<ChartColor, { line: string; dot: string; bg: string }>

export const DEFAULT_CHART_COLOR: ChartColor = 'blue-2'

export type { ChartColor }

/** A single expanded annotation occurrence to render on the chart. */
export type AnnotationMark = {
  annotationId: string
  label: string
  occurrenceDate: Date
  /** When set, renders a shaded band from occurrenceDate to endDate. */
  endDate?: Date | null
  color?: string | null
}

export type ChartSeries<T> = {
  /** Unique identifier for this series, e.g. an instrument id. */
  id: string
  data: T[]
  color: ChartColor
  /**
   * Mark a trailing run of points as "projected" (no underlying data, e.g. a
   * balance carried forward with no transactions). These render as a dashed
   * line, connected to the last non-projected point.
   */
  isProjected?: (d: T) => boolean
}

/** A point matched to the hovered x-position, one per series. */
export type TooltipPoint<T> = {
  seriesId: string
  point: T
  color: ChartColor
}

export type LineAreaChartProps<T> = {
  series: ChartSeries<T>[]
  x: (d: T) => Date
  y: (d: T) => number
  height?: number
  /** Format an x-axis tick label for the given data point's date and index. */
  tickFormat?: (date: Date, index: number) => string
  /** Number of x-axis ticks to show (auto-spaced). Defaults to one tick per data point. */
  numTicks?: number
  /** Render the tooltip contents shown when hovering near a point, one entry per series. */
  renderTooltip?: (points: TooltipPoint<T>[]) => React.ReactNode
  /** Draw a dashed line at y=0 when zero falls within the visible range. */
  zeroLine?: boolean
  /** Fix the lower bound of the y-axis (e.g. 0), instead of auto-scaling with padding. */
  yMin?: number
  /** Fix the upper bound of the y-axis, instead of auto-scaling with padding. */
  yMax?: number
  /** Format a y-axis tick label for the given value. Defaults to a plain number. */
  yTickFormat?: (value: number) => string
  /** Number of y-axis ticks to show (auto-spaced). Defaults to 4. */
  yNumTicks?: number
  /** Line interpolation curve. Defaults to `curveMonotoneX` (smoothed). */
  curve?: CurveFactory
  /** Expanded annotation occurrences to render as vertical dotted lines with hover tooltips. */
  annotations?: AnnotationMark[]
}

/**
 * A responsive multi-series line chart for small time series, built on visx.
 * Renders nothing if every series is empty.
 */
export default function LineAreaChart<T>({ height = 160, ...props }: LineAreaChartProps<T>) {
  if (props.series.every((s) => s.data.length === 0)) return null

  return (
    <div style={{ height }}>
      <ParentSize>{({ width }) => (width > 0 ? <Chart {...props} width={width} height={height} /> : null)}</ParentSize>
    </div>
  )
}

function Chart<T>({
  series,
  x,
  y,
  width,
  height,
  tickFormat,
  numTicks,
  renderTooltip,
  zeroLine = true,
  yMin: fixedYMin,
  yMax: fixedYMax,
  yTickFormat,
  yNumTicks = 4,
  curve = curveMonotoneX,
  annotations,
}: LineAreaChartProps<T> & { width: number; height: number }) {
  const { tooltipData, tooltipLeft, tooltipTop, tooltipOpen, showTooltip, hideTooltip } =
    useTooltip<TooltipPoint<T>[]>()

  const {
    tooltipData: annotTooltipData,
    tooltipLeft: annotTooltipLeft,
    tooltipTop: annotTooltipTop,
    tooltipOpen: annotTooltipOpen,
    showTooltip: showAnnotTooltip,
    hideTooltip: hideAnnotTooltip,
  } = useTooltip<AnnotationMark[]>()

  const nonEmptySeries = React.useMemo(() => series.filter((s) => s.data.length > 0), [series])

  // Reference series (the one with the most points) drives x-axis tick placement.
  const tickSeries = React.useMemo(
    () => nonEmptySeries.reduce((longest, s) => (s.data.length > longest.data.length ? s : longest), nonEmptySeries[0]),
    [nonEmptySeries],
  )
  const tickXValues = React.useMemo(() => tickSeries.data.map(x), [tickSeries, x])

  const xDomain = React.useMemo<[Date, Date]>(() => {
    const times = nonEmptySeries.flatMap((s) => s.data.map((d) => x(d).getTime()))
    const min = Math.min(...times)
    const max = Math.max(...times)
    if (min === max) return [new Date(min - 1), new Date(max + 1)]
    return [new Date(min), new Date(max)]
  }, [nonEmptySeries, x])

  const xScale = React.useMemo(
    () => scaleTime({ domain: xDomain, range: [MARGIN.left, width - MARGIN.right] }),
    [xDomain, width],
  )

  const yScale = React.useMemo(() => {
    const yValues = nonEmptySeries.flatMap((s) => s.data.map(y))
    const dataMin = Math.min(...yValues)
    const dataMax = Math.max(...yValues)
    const pad = (dataMax - dataMin) * 0.1 || Math.abs(dataMax) * 0.1 || 1
    return scaleLinear({
      domain: [fixedYMin ?? dataMin - pad, fixedYMax ?? dataMax + pad],
      range: [height - MARGIN.bottom, MARGIN.top],
    })
  }, [nonEmptySeries, y, height, fixedYMin, fixedYMax])

  const ANNOTATION_SNAP_PX = 8

  const handlePointerMove = (event: React.MouseEvent | React.TouchEvent) => {
    const point = localPoint(event)
    if (!point) return

    // Check annotation proximity first — show annotation tooltip if near a line or inside a band.
    if (annotations && annotations.length > 0) {
      const near = annotations.filter((ann) => {
        const axPos = xScale(ann.occurrenceDate)
        if (ann.endDate) {
          const axEnd = xScale(ann.endDate)
          return point.x >= axPos - ANNOTATION_SNAP_PX && point.x <= axEnd + ANNOTATION_SNAP_PX
        }
        return Math.abs(axPos - point.x) < ANNOTATION_SNAP_PX
      })
      if (near.length > 0) {
        showAnnotTooltip({
          tooltipData: near,
          tooltipLeft: xScale(near[0].occurrenceDate),
          tooltipTop: MARGIN.top + 8,
        })
        hideTooltip()
        return
      }
    }
    hideAnnotTooltip()

    const targetX = xScale.invert(point.x).getTime()

    const matched: TooltipPoint<T>[] = []
    for (const s of nonEmptySeries) {
      let closestIndex = 0
      let closestDist = Infinity
      for (let i = 0; i < s.data.length; i++) {
        const dist = Math.abs(x(s.data[i]).getTime() - targetX)
        if (dist < closestDist) {
          closestDist = dist
          closestIndex = i
        }
      }
      matched.push({ seriesId: s.id, point: s.data[closestIndex], color: s.color })
    }
    if (matched.length === 0) return

    const refPoint = matched[0].point
    showTooltip({
      tooltipData: matched,
      tooltipLeft: xScale(x(refPoint)),
      tooltipTop: yScale(y(refPoint)),
    })
  }

  const [yDomainMin, yDomainMax] = yScale.domain()
  const showZeroLine = zeroLine && yDomainMin <= 0 && yDomainMax >= 0
  const showDots = nonEmptySeries.length === 1 && nonEmptySeries[0].data.length <= 20

  return (
    <div className="relative">
      <svg width={width} height={height}>
        <GridRows
          scale={yScale}
          width={Math.max(width - MARGIN.left - MARGIN.right, 0)}
          left={MARGIN.left}
          numTicks={yNumTicks}
          className="stroke-gray-100 dark:stroke-gray-800"
        />
        {showZeroLine && (
          <Line
            from={{ x: MARGIN.left, y: yScale(0) }}
            to={{ x: width - MARGIN.right, y: yScale(0) }}
            className="stroke-gray-300 dark:stroke-gray-700"
            strokeDasharray="4 4"
          />
        )}
        {/* Annotation marks — vertical dotted lines (point) or shaded bands (range) */}
        {annotations?.map((ann) => {
          const xPos = xScale(ann.occurrenceDate)
          const chartRight = width - MARGIN.right
          const chartTop = MARGIN.top
          const chartBottom = height - MARGIN.bottom
          if (ann.endDate) {
            const xEnd = xScale(ann.endDate)
            if (xEnd < MARGIN.left || xPos > chartRight) return null
            const x1 = Math.max(xPos, MARGIN.left)
            const x2 = Math.min(xEnd, chartRight)
            return (
              <g key={`${ann.annotationId}-${ann.occurrenceDate.getTime()}`} pointerEvents="none">
                <rect
                  x={x1}
                  y={chartTop}
                  width={Math.max(x2 - x1, 0)}
                  height={chartBottom - chartTop}
                  className="fill-amber-400/15 dark:fill-amber-500/15"
                />
                {xPos >= MARGIN.left && (
                  <Line
                    from={{ x: xPos, y: chartTop }}
                    to={{ x: xPos, y: chartBottom }}
                    stroke="currentColor"
                    className="stroke-amber-400 dark:stroke-amber-500"
                    strokeWidth={1.5}
                    strokeDasharray="3 3"
                  />
                )}
                {xEnd <= chartRight && (
                  <Line
                    from={{ x: xEnd, y: chartTop }}
                    to={{ x: xEnd, y: chartBottom }}
                    stroke="currentColor"
                    className="stroke-amber-400 dark:stroke-amber-500"
                    strokeWidth={1.5}
                    strokeDasharray="3 3"
                  />
                )}
              </g>
            )
          }
          if (xPos < MARGIN.left || xPos > chartRight) return null
          return (
            <Line
              key={`${ann.annotationId}-${ann.occurrenceDate.getTime()}`}
              from={{ x: xPos, y: chartTop }}
              to={{ x: xPos, y: chartBottom }}
              stroke="currentColor"
              className="stroke-amber-400 dark:stroke-amber-500"
              strokeWidth={1.5}
              strokeDasharray="3 3"
              pointerEvents="none"
            />
          )
        })}
        {nonEmptySeries.map((s) => {
          const colors = COLOR_CLASSES[s.color]
          const firstProjectedIndex = s.isProjected ? s.data.findIndex((d) => s.isProjected!(d)) : -1
          const hasProjected = firstProjectedIndex > 0
          const solidData = hasProjected ? s.data.slice(0, firstProjectedIndex) : s.data
          const dashedData = hasProjected ? s.data.slice(firstProjectedIndex - 1) : []

          return (
            <g key={s.id}>
              <LinePath
                data={solidData}
                x={(d) => xScale(x(d))}
                y={(d) => yScale(y(d))}
                curve={curve}
                fill="none"
                strokeWidth={2}
                className={colors.line}
              />
              {hasProjected && (
                <LinePath
                  data={dashedData}
                  x={(d) => xScale(x(d))}
                  y={(d) => yScale(y(d))}
                  curve={curve}
                  fill="none"
                  strokeWidth={2}
                  strokeDasharray="4 4"
                  className={colors.line}
                />
              )}
              {showDots &&
                s.data.map((d, i) => (
                  <circle key={i} cx={xScale(x(d))} cy={yScale(y(d))} r={3} className={colors.dot} />
                ))}
            </g>
          )
        })}
        <AxisBottom
          top={height - MARGIN.bottom}
          scale={xScale}
          {...(numTicks === undefined || tickXValues.length <= numTicks ? { tickValues: tickXValues } : { numTicks })}
          tickFormat={(value, index) => {
            const date = value as unknown as Date
            return tickFormat ? tickFormat(date, index) : date.toLocaleDateString('en-AU', { month: 'short' })
          }}
          stroke="transparent"
          tickStroke="transparent"
          tickLabelProps={(_value, index, ticks) => ({
            className: 'fill-gray-500 dark:fill-gray-400',
            fontSize: 10,
            textAnchor: index === 0 ? 'start' : index === ticks.length - 1 ? 'end' : ('middle' as const),
          })}
        />
        <AxisLeft
          left={MARGIN.left}
          scale={yScale}
          numTicks={yNumTicks}
          tickFormat={(value) => (yTickFormat ? yTickFormat(value as unknown as number) : String(value))}
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
        {tooltipOpen && tooltipData && (
          <g pointerEvents="none">
            <Line
              from={{ x: tooltipLeft, y: MARGIN.top }}
              to={{ x: tooltipLeft, y: height - MARGIN.bottom }}
              className="stroke-gray-300 dark:stroke-gray-700"
              strokeDasharray="2 2"
            />
            {tooltipData.map((p) => (
              <circle
                key={p.seriesId}
                cx={xScale(x(p.point))}
                cy={yScale(y(p.point))}
                r={4}
                strokeWidth={2}
                className={`${COLOR_CLASSES[p.color].dot} stroke-white dark:stroke-gray-900`}
              />
            ))}
          </g>
        )}
        <Bar
          x={MARGIN.left}
          y={MARGIN.top}
          width={Math.max(width - MARGIN.left - MARGIN.right, 0)}
          height={Math.max(height - MARGIN.top - MARGIN.bottom, 0)}
          fill="transparent"
          onMouseMove={handlePointerMove}
          onMouseLeave={() => { hideTooltip(); hideAnnotTooltip() }}
          onTouchMove={handlePointerMove}
          onTouchEnd={() => { hideTooltip(); hideAnnotTooltip() }}
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

      {annotTooltipOpen && annotTooltipData && (
        <TooltipWithBounds
          left={annotTooltipLeft}
          top={annotTooltipTop}
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
          <div className="bg-white dark:bg-gray-800 border border-amber-300 dark:border-amber-700 rounded-md shadow-lg px-2 py-1 text-xs text-gray-900 dark:text-gray-100 whitespace-nowrap">
            {annotTooltipData.map((ann) => (
              <div key={`${ann.annotationId}-${ann.occurrenceDate.getTime()}`} className="flex items-center gap-1.5">
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-400 dark:bg-amber-500" />
                <span className="font-medium">{ann.label}</span>
                <span className="text-gray-400 dark:text-gray-500">
                  {ann.occurrenceDate.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })}
                  {ann.endDate && ` – ${ann.endDate.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })}`}
                </span>
              </div>
            ))}
          </div>
        </TooltipWithBounds>
      )}
    </div>
  )
}
