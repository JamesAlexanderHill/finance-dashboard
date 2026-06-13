import * as React from 'react'
import { ParentSize } from '@visx/responsive'
import { scaleLinear, scaleTime } from '@visx/scale'
import { LinePath, Line, Bar } from '@visx/shape'
import { AxisBottom, AxisLeft } from '@visx/axis'
import { GridRows } from '@visx/grid'
import { useTooltip, TooltipWithBounds } from '@visx/tooltip'
import { localPoint } from '@visx/event'
import { curveMonotoneX } from '@visx/curve'

const MARGIN = { top: 8, right: 8, bottom: 20, left: 44 }

export const COLOR_CLASSES = {
  blue: {
    line: 'stroke-blue-500 dark:stroke-blue-400',
    dot: 'fill-blue-500 dark:fill-blue-400',
    bg: 'bg-blue-500 dark:bg-blue-400',
  },
  red: {
    line: 'stroke-red-400',
    dot: 'fill-red-400',
    bg: 'bg-red-400',
  },
  green: {
    line: 'stroke-green-500 dark:stroke-green-400',
    dot: 'fill-green-500 dark:fill-green-400',
    bg: 'bg-green-500 dark:bg-green-400',
  },
  purple: {
    line: 'stroke-purple-500 dark:stroke-purple-400',
    dot: 'fill-purple-500 dark:fill-purple-400',
    bg: 'bg-purple-500 dark:bg-purple-400',
  },
  orange: {
    line: 'stroke-orange-500 dark:stroke-orange-400',
    dot: 'fill-orange-500 dark:fill-orange-400',
    bg: 'bg-orange-500 dark:bg-orange-400',
  },
  teal: {
    line: 'stroke-teal-500 dark:stroke-teal-400',
    dot: 'fill-teal-500 dark:fill-teal-400',
    bg: 'bg-teal-500 dark:bg-teal-400',
  },
  pink: {
    line: 'stroke-pink-500 dark:stroke-pink-400',
    dot: 'fill-pink-500 dark:fill-pink-400',
    bg: 'bg-pink-500 dark:bg-pink-400',
  },
  gray: {
    line: 'stroke-gray-400 dark:stroke-gray-500',
    dot: 'fill-gray-400 dark:fill-gray-500',
    bg: 'bg-gray-400 dark:bg-gray-500',
  },
} as const

export type ChartColor = keyof typeof COLOR_CLASSES

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
}: LineAreaChartProps<T> & { width: number; height: number }) {
  const { tooltipData, tooltipLeft, tooltipTop, tooltipOpen, showTooltip, hideTooltip } =
    useTooltip<TooltipPoint<T>[]>()

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

  const handlePointerMove = (event: React.MouseEvent | React.TouchEvent) => {
    const point = localPoint(event)
    if (!point) return

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
                curve={curveMonotoneX}
                fill="none"
                strokeWidth={2}
                className={colors.line}
              />
              {hasProjected && (
                <LinePath
                  data={dashedData}
                  x={(d) => xScale(x(d))}
                  y={(d) => yScale(y(d))}
                  curve={curveMonotoneX}
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
          onMouseLeave={hideTooltip}
          onTouchMove={handlePointerMove}
          onTouchEnd={hideTooltip}
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
