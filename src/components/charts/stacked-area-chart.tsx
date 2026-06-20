import * as React from 'react'
import { ParentSize } from '@visx/responsive'
import { scaleLinear, scaleTime } from '@visx/scale'
import { AreaStack, Line, Bar } from '@visx/shape'
import { AxisBottom, AxisLeft } from '@visx/axis'
import { GridRows } from '@visx/grid'
import { useTooltip, TooltipWithBounds } from '@visx/tooltip'
import { localPoint } from '@visx/event'
import { curveMonotoneX } from '@visx/curve'
import type { CurveFactory } from '@visx/vendor/d3-shape'

import { MARGIN, COLOR_CLASSES, DEFAULT_CHART_COLOR, type ChartColor, type AnnotationMark } from './line-area-chart'

export type StackMode = 'net' | 'separated'

/** One x-position's worth of stacked values, keyed by series id. */
export type StackedAreaDatum = {
  period: Date
  values: Record<string, number>
}

export type StackedAreaKey = {
  id: string
  color: ChartColor
}

export type StackedAreaChartProps = {
  data: StackedAreaDatum[]
  keys: StackedAreaKey[]
  height?: number
  /** Format an x-axis tick label for the given data point's date and index. */
  tickFormat?: (date: Date, index: number) => string
  /** Number of x-axis ticks to show (auto-spaced). Defaults to one tick per data point. */
  numTicks?: number
  /** Format a y-axis tick label for the given (cumulative) value. Defaults to a plain number. */
  yTickFormat?: (value: number) => string
  /** Number of y-axis ticks to show (auto-spaced). Defaults to 4. */
  yNumTicks?: number
  /** Line interpolation curve. Defaults to `curveMonotoneX` (smoothed). */
  curve?: CurveFactory
  /** Render the tooltip contents shown when hovering near a point. */
  renderTooltip?: (datum: StackedAreaDatum) => React.ReactNode
  /** Expanded annotation occurrences to render as vertical dotted lines with hover tooltips. */
  annotations?: AnnotationMark[]
  /**
   * How debt and asset series are stacked:
   * - `'net'` (default): negative series stack below zero first, then positive series
   *   stack on top of the cumulative debt — shows true net position.
   * - `'separated'`: positive series stack upward from zero and negative series
   *   stack downward from zero independently — shows gross assets vs gross liabilities.
   */
  stackMode?: StackMode
}

/**
 * A responsive stacked area chart for small time series, built on visx
 * (cf. https://visx.airbnb.tech/stacked-areas). Renders nothing if `data` is empty.
 */
export default function StackedAreaChart({ height = 160, ...props }: StackedAreaChartProps) {
  if (props.data.length === 0) return null

  return (
    <div style={{ height }}>
      <ParentSize>{({ width }) => (width > 0 ? <Chart {...props} width={width} height={height} /> : null)}</ParentSize>
    </div>
  )
}

function Chart({
  data,
  keys,
  width,
  height,
  tickFormat,
  numTicks,
  yTickFormat,
  yNumTicks = 4,
  curve = curveMonotoneX,
  renderTooltip,
  annotations,
  stackMode = 'net',
}: StackedAreaChartProps & { width: number; height: number }) {
  const { tooltipData, tooltipLeft, tooltipOpen, showTooltip, hideTooltip } = useTooltip<StackedAreaDatum>()

  const {
    tooltipData: annotTooltipData,
    tooltipLeft: annotTooltipLeft,
    tooltipTop: annotTooltipTop,
    tooltipOpen: annotTooltipOpen,
    showTooltip: showAnnotTooltip,
    hideTooltip: hideAnnotTooltip,
  } = useTooltip<AnnotationMark[]>()

  const xDomain = React.useMemo<[Date, Date]>(() => {
    const times = data.map((d) => d.period.getTime())
    const min = Math.min(...times)
    const max = Math.max(...times)
    if (min === max) return [new Date(min - 1), new Date(max + 1)]
    return [new Date(min), new Date(max)]
  }, [data])

  const xScale = React.useMemo(
    () => scaleTime({ domain: xDomain, range: [MARGIN.left, width - MARGIN.right] }),
    [xDomain, width],
  )

  // In net mode, sort keys so negative series (debts) come first — they stack
  // below zero and positive series (assets) stack on top of the total debt.
  const sortedKeys = React.useMemo(() => {
    if (stackMode !== 'net' || data.length === 0) return keys
    const lastDatum = data[data.length - 1]
    return [...keys].sort((a, b) => {
      const va = lastDatum.values[a.id] ?? 0
      const vb = lastDatum.values[b.id] ?? 0
      if (va < 0 && vb >= 0) return -1
      if (va >= 0 && vb < 0) return 1
      return 0
    })
  }, [keys, data, stackMode])

  const yScale = React.useMemo(() => {
    let min = 0
    let max = 0
    if (stackMode === 'separated') {
      // Positive and negative stacks are independent from zero.
      for (const d of data) {
        let posSum = 0
        let negSum = 0
        for (const key of sortedKeys) {
          const v = d.values[key.id] ?? 0
          if (v >= 0) posSum += v
          else negSum += v
        }
        if (posSum > max) max = posSum
        if (negSum < min) min = negSum
      }
    } else {
      // Net mode: cumulative sum — negatives build the debt trough, positives climb from there.
      for (const d of data) {
        let cumulative = 0
        for (const key of sortedKeys) {
          cumulative += d.values[key.id] ?? 0
          if (cumulative > max) max = cumulative
          if (cumulative < min) min = cumulative
        }
      }
    }
    const pad = (max - min) * 0.1 || Math.abs(max) * 0.1 || 1
    return scaleLinear({
      domain: [min < 0 ? min - pad : 0, max + pad],
      range: [height - MARGIN.bottom, MARGIN.top],
    })
  }, [data, sortedKeys, height, stackMode])

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

    let closestIndex = 0
    let closestDist = Infinity
    for (let i = 0; i < data.length; i++) {
      const dist = Math.abs(data[i].period.getTime() - targetX)
      if (dist < closestDist) {
        closestDist = dist
        closestIndex = i
      }
    }

    const datum = data[closestIndex]
    showTooltip({
      tooltipData: datum,
      tooltipLeft: xScale(datum.period),
      tooltipTop: MARGIN.top,
    })
  }

  const [yDomainMin, yDomainMax] = yScale.domain()
  const showZeroLine = yDomainMin < 0 && yDomainMax >= 0
  const tickXValues = data.map((d) => d.period)

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
        <AreaStack
          data={data}
          keys={sortedKeys.map((k) => k.id)}
          value={(d: StackedAreaDatum, key) => d.values[key] ?? 0}
          x={(d) => xScale(d.data.period)}
          y0={(d) => yScale(d[0])}
          y1={(d) => yScale(d[1])}
          curve={curve}
          {...(stackMode === 'separated' ? { offset: 'diverging' as const } : {})}
        >
          {({ stacks, path }) =>
            stacks.map((stack) => {
              const color = sortedKeys.find((k) => k.id === stack.key)?.color ?? DEFAULT_CHART_COLOR
              const colors = COLOR_CLASSES[color]
              return (
                <path
                  key={stack.key}
                  d={path(stack) ?? ''}
                  className={colors.dot}
                  fillOpacity={0.5}
                  stroke="none"
                />
              )
            })
          }
        </AreaStack>
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
          top={MARGIN.top}
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
