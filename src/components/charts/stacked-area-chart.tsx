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
import { MARGIN, COLOR_CLASSES, DEFAULT_CHART_COLOR, type ChartColor } from './line-area-chart'

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
}: StackedAreaChartProps & { width: number; height: number }) {
  const { tooltipData, tooltipLeft, tooltipOpen, showTooltip, hideTooltip } = useTooltip<StackedAreaDatum>()

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

  const yScale = React.useMemo(() => {
    let min = 0
    let max = 0
    for (const d of data) {
      let cumulative = 0
      for (const key of keys) {
        cumulative += d.values[key.id] ?? 0
        if (cumulative > max) max = cumulative
        if (cumulative < min) min = cumulative
      }
    }
    const pad = (max - min) * 0.1 || Math.abs(max) * 0.1 || 1
    return scaleLinear({
      domain: [min < 0 ? min - pad : 0, max + pad],
      range: [height - MARGIN.bottom, MARGIN.top],
    })
  }, [data, keys, height])

  const handlePointerMove = (event: React.MouseEvent | React.TouchEvent) => {
    const point = localPoint(event)
    if (!point) return

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
        <AreaStack
          data={data}
          keys={keys.map((k) => k.id)}
          value={(d: StackedAreaDatum, key) => d.values[key] ?? 0}
          x={(d) => xScale(d.data.period)}
          y0={(d) => yScale(d[0])}
          y1={(d) => yScale(d[1])}
          curve={curve}
        >
          {({ stacks, path }) =>
            stacks.map((stack) => {
              const color = keys.find((k) => k.id === stack.key)?.color ?? DEFAULT_CHART_COLOR
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
          onMouseLeave={hideTooltip}
          onTouchMove={handlePointerMove}
          onTouchEnd={hideTooltip}
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
    </div>
  )
}
