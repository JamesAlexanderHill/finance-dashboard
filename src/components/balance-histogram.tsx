import { useState } from 'react'
import { useQueries } from '@tanstack/react-query'
import { createServerFn } from '@tanstack/react-start'
import { db } from '~/db'
import { users } from '~/db/schema'
import type { Instrument } from '~/db/schema'
import type { BalanceHistoryPeriod, BalanceHistoryRange, BalancePoint } from '~/db/services'
import { instrumentService, createContext } from '~/db/services'
import { formatBalance } from '~/lib/format'
import scaleUnit from '~/lib/scale-unit'
import { LineAreaChart, COLOR_CLASSES, type ChartColor, type ChartSeries, type TooltipPoint } from '~/components/charts'

// ─── Server functions ─────────────────────────────────────────────────────────

const getBalanceHistory = createServerFn({ method: 'GET' })
  .inputValidator((data: unknown) => data as { instrumentId: string; range: BalanceHistoryRange; period: BalanceHistoryPeriod })
  .handler(async ({ data }) => {
    const [user] = await db.select().from(users).limit(1)
    if (!user) return []

    const ctx = createContext(user.id)
    return instrumentService.getBalanceHistory(ctx, data.instrumentId, data.range, data.period)
  })

// ─── Types ────────────────────────────────────────────────────────────────────

type BalanceHistogramProps = {
  instruments: Instrument[]
  defaultInstrumentId: string | null
  /** Pre-fetched 30D/daily history for `defaultInstrumentId`, from the route loader. */
  initialData: BalancePoint[]
}

type ChartPoint = {
  period: Date
  balance: bigint
  value: number
  projected: boolean
}

const DEFAULT_RANGE: BalanceHistoryRange = '30d'
const DEFAULT_PERIOD: BalanceHistoryPeriod = 'day'

const RANGE_OPTIONS: { value: BalanceHistoryRange; label: string }[] = [
  { value: '30d', label: '30D' },
  { value: '90d', label: '90D' },
  { value: '1y', label: '1Y' },
  { value: 'all', label: 'All' },
]

const PERIOD_OPTIONS: { value: BalanceHistoryPeriod; label: string }[] = [
  { value: 'day', label: 'Daily' },
  { value: 'week', label: 'Weekly' },
  { value: 'month', label: 'Monthly' },
]

// Colors are assigned to instruments by position, so each instrument keeps a
// stable color regardless of which others are currently visible.
const COLOR_ORDER: ChartColor[] = ['blue', 'red', 'green', 'purple', 'orange', 'teal', 'pink', 'gray']

// ─── Component ────────────────────────────────────────────────────────────────

export default function BalanceHistogram({ instruments, defaultInstrumentId, initialData }: BalanceHistogramProps) {
  const [range, setRange] = useState<BalanceHistoryRange>(DEFAULT_RANGE)
  const [period, setPeriod] = useState<BalanceHistoryPeriod>(DEFAULT_PERIOD)
  const [visible, setVisible] = useState<Set<string>>(() => new Set(instruments.map((i) => i.id)))

  const queries = useQueries({
    queries: instruments.map((instrument) => ({
      queryKey: ['balance-history', instrument.id, range, period],
      queryFn: () => getBalanceHistory({ data: { instrumentId: instrument.id, range, period } }),
      initialData:
        instrument.id === defaultInstrumentId && range === DEFAULT_RANGE && period === DEFAULT_PERIOD
          ? initialData
          : undefined,
      placeholderData: (prev?: BalancePoint[]) => prev,
      enabled: visible.has(instrument.id),
    })),
  })

  if (instruments.length === 0) return null

  const isFetching = queries.some((q) => q.isFetching)

  const series: ChartSeries<ChartPoint>[] = instruments
    .map((instrument, index): ChartSeries<ChartPoint> | null => {
      if (!visible.has(instrument.id)) return null
      const history = queries[index].data
      if (!history || history.length === 0) return null

      const data: ChartPoint[] = history.map((point) => ({
        period: new Date(point.period),
        balance: BigInt(point.balance),
        value: scaleUnit(point.balance, instrument.exponent),
        projected: point.projected,
      }))

      return {
        id: instrument.id,
        data,
        color: COLOR_ORDER[index % COLOR_ORDER.length],
        isProjected: (d: ChartPoint) => d.projected,
      }
    })
    .filter((s): s is ChartSeries<ChartPoint> => s !== null)

  const referenceInstrument = instruments.find((i) => i.id === defaultInstrumentId) ?? instruments[0]
  const yTickFormat = (value: number) => formatAxisValue(value, referenceInstrument.ticker)

  function toggle(instrumentId: string) {
    setVisible((prev) => {
      const next = new Set(prev)
      if (next.has(instrumentId)) next.delete(instrumentId)
      else next.add(instrumentId)
      return next
    })
  }

  return (
    <section className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-6">
      <div className="flex items-center justify-between gap-4 mb-4 flex-wrap">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Balance History</h2>

        <div className="flex items-center gap-2">
          <SegmentedControl options={PERIOD_OPTIONS} value={period} onChange={setPeriod} />
          <SegmentedControl options={RANGE_OPTIONS} value={range} onChange={setRange} />
        </div>
      </div>

      {instruments.length > 1 && (
        <div className="flex items-center gap-3 mb-4 flex-wrap">
          {instruments.map((instrument, index) => {
            const color = COLOR_ORDER[index % COLOR_ORDER.length]
            const checked = visible.has(instrument.id)
            return (
              <label
                key={instrument.id}
                className={`inline-flex items-center gap-1.5 text-sm cursor-pointer select-none ${
                  checked ? 'text-gray-900 dark:text-gray-100' : 'text-gray-400 dark:text-gray-500'
                }`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggle(instrument.id)}
                  className="sr-only"
                />
                <span className={`inline-block w-2.5 h-2.5 rounded-full ${checked ? COLOR_CLASSES[color].bg : 'bg-gray-300 dark:bg-gray-700'}`} />
                {instrument.ticker}
              </label>
            )
          })}
        </div>
      )}

      <div className={isFetching ? 'opacity-60 transition-opacity' : 'transition-opacity'}>
        {series.length > 0 ? (
          <LineAreaChart
            series={series}
            x={(d) => d.period}
            y={(d) => d.value}
            numTicks={6}
            yTickFormat={yTickFormat}
            tickFormat={(date) =>
              period === 'month'
                ? date.toLocaleDateString('en-AU', { month: 'short', year: '2-digit' })
                : date.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })
            }
            renderTooltip={(points) => (
              <>
                <div className="font-medium">
                  {points[0].point.period.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })}
                </div>
                {points.map((p) => (
                  <TooltipRow key={p.seriesId} point={p} instruments={instruments} />
                ))}
              </>
            )}
          />
        ) : (
          <p className="text-sm text-gray-500 dark:text-gray-400 py-8 text-center">
            Select an instrument above to show its balance history.
          </p>
        )}
      </div>
    </section>
  )
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function TooltipRow({ point, instruments }: { point: TooltipPoint<ChartPoint>; instruments: Instrument[] }) {
  const instrument = instruments.find((i) => i.id === point.seriesId)
  if (!instrument) return null

  return (
    <div className="flex items-center gap-1.5 tabular-nums">
      <span className={`inline-block w-2 h-2 rounded-full ${COLOR_CLASSES[point.color].bg}`} />
      <span>{formatBalance(point.point.balance, instrument)}</span>
      {point.point.projected && <span className="text-gray-400 dark:text-gray-500">(no activity)</span>}
    </div>
  )
}

// Compact currency label for y-axis ticks, e.g. "$1.2K". Falls back to a plain
// compact number if `ticker` isn't a valid ISO currency code (e.g. share tickers).
function formatAxisValue(value: number, ticker: string): string {
  try {
    return new Intl.NumberFormat('en-AU', {
      style: 'currency',
      currency: ticker,
      currencyDisplay: 'narrowSymbol',
      notation: 'compact',
      maximumFractionDigits: 1,
    }).format(value)
  } catch {
    return new Intl.NumberFormat('en-AU', { notation: 'compact', maximumFractionDigits: 1 }).format(value)
  }
}

function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[]
  value: T
  onChange: (value: T) => void
}) {
  return (
    <div className="inline-flex rounded-lg border border-gray-200 dark:border-gray-700 p-0.5">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
            value === opt.value
              ? 'bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900'
              : 'text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100'
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}
