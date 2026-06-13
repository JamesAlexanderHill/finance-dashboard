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

const COLOR_CLASSES = {
  blue: {
    line: 'stroke-blue-500 dark:stroke-blue-400',
    dot: 'fill-blue-500 dark:fill-blue-400',
  },
  red: {
    line: 'stroke-red-400',
    dot: 'fill-red-400',
  },
  green: {
    line: 'stroke-green-500 dark:stroke-green-400',
    dot: 'fill-green-500 dark:fill-green-400',
  },
  gray: {
    line: 'stroke-gray-400 dark:stroke-gray-500',
    dot: 'fill-gray-400 dark:fill-gray-500',
  },
} as const

export type ChartColor = keyof typeof COLOR_CLASSES

export type LineAreaChartProps<T> = {
  data: T[]
  x: (d: T) => Date
  y: (d: T) => number
  height?: number
  color?: ChartColor
  /** Format an x-axis tick label for the given data point's date and index. */
  tickFormat?: (date: Date, index: number) => string
  /** Number of x-axis ticks to show (auto-spaced). Defaults to one tick per data point. */
  numTicks?: number
  /** Render the tooltip contents shown when hovering near a data point. */
  renderTooltip?: (d: T) => React.ReactNode
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
  /**
   * Mark a trailing run of points as "projected" (no underlying data, e.g. a
   * balance carried forward with no transactions). These render as a dashed
   * line with no area fill, connected to the last non-projected point.
   */
  isProjected?: (d: T) => boolean
}

/**
 * A responsive line + area chart for a small time series, built on visx.
 * Renders nothing if `data` is empty.
 */
export default function LineAreaChart<T>({ height = 160, ...props }: LineAreaChartProps<T>) {
  if (props.data.length === 0) return null

  return (
    <div style={{ height }}>
      <ParentSize>{({ width }) => (width > 0 ? <Chart {...props} width={width} height={height} /> : null)}</ParentSize>
    </div>
  )
}

function Chart<T>({
  data,
  x,
  y,
  width,
  height,
  color = 'blue',
  tickFormat,
  numTicks,
  renderTooltip,
  zeroLine = true,
  yMin: fixedYMin,
  yMax: fixedYMax,
  yTickFormat,
  yNumTicks = 4,
  isProjected,
}: LineAreaChartProps<T> & { width: number; height: number }) {
  const { tooltipData, tooltipLeft, tooltipTop, tooltipOpen, showTooltip, hideTooltip } = useTooltip<T>()
  const colors = COLOR_CLASSES[color]

  const xValues = React.useMemo(() => data.map(x), [data, x])
  const yValues = React.useMemo(() => data.map(y), [data, y])

  // Split off a trailing run of "projected" points so they can render as a
  // dashed line with no area fill, connected to the last solid point.
  const firstProjectedIndex = isProjected ? data.findIndex((d) => isProjected(d)) : -1
  const hasProjected = firstProjectedIndex > 0
  const solidData = hasProjected ? data.slice(0, firstProjectedIndex) : data
  const dashedData = hasProjected ? data.slice(firstProjectedIndex - 1) : []

  const xDomain = React.useMemo<[Date, Date]>(() => {
    if (xValues.length === 1) {
      const only = xValues[0]
      return [new Date(only.getTime() - 1), new Date(only.getTime() + 1)]
    }
    return [xValues[0], xValues[xValues.length - 1]]
  }, [xValues])

  const xScale = React.useMemo(
    () => scaleTime({ domain: xDomain, range: [MARGIN.left, width - MARGIN.right] }),
    [xDomain, width],
  )

  const yScale = React.useMemo(() => {
    const dataMin = Math.min(...yValues)
    const dataMax = Math.max(...yValues)
    const pad = (dataMax - dataMin) * 0.1 || Math.abs(dataMax) * 0.1 || 1
    return scaleLinear({
      domain: [fixedYMin ?? dataMin - pad, fixedYMax ?? dataMax + pad],
      range: [height - MARGIN.bottom, MARGIN.top],
    })
  }, [yValues, height, fixedYMin, fixedYMax])

  const handlePointerMove = (event: React.MouseEvent | React.TouchEvent) => {
    const point = localPoint(event)
    if (!point) return

    const targetX = xScale.invert(point.x).getTime()
    let closestIndex = 0
    let closestDist = Infinity
    for (let i = 0; i < xValues.length; i++) {
      const dist = Math.abs(xValues[i].getTime() - targetX)
      if (dist < closestDist) {
        closestDist = dist
        closestIndex = i
      }
    }

    const closest = data[closestIndex]
    showTooltip({
      tooltipData: closest,
      tooltipLeft: xScale(x(closest)),
      tooltipTop: yScale(y(closest)),
    })
  }

  const [yDomainMin, yDomainMax] = yScale.domain()
  const showZeroLine = zeroLine && yDomainMin <= 0 && yDomainMax >= 0

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
        {data.length <= 20 &&
          data.map((d, i) => (
            <circle key={i} cx={xScale(x(d))} cy={yScale(y(d))} r={3} className={colors.dot} />
          ))}
        <AxisBottom
          top={height - MARGIN.bottom}
          scale={xScale}
          {...(numTicks === undefined || xValues.length <= numTicks ? { tickValues: xValues } : { numTicks })}
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
            <circle
              cx={tooltipLeft}
              cy={tooltipTop}
              r={4}
              strokeWidth={2}
              className={`${colors.dot} stroke-white dark:stroke-gray-900`}
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
