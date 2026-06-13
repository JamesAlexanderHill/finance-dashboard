import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { createServerFn } from '@tanstack/react-start'
import { db } from '~/db'
import { users } from '~/db/schema'
import type { Instrument } from '~/db/schema'
import type { BalanceHistoryPeriod, BalanceHistoryRange, BalancePoint } from '~/db/services'
import { instrumentService, createContext } from '~/db/services'
import { formatBalance } from '~/lib/format'
import scaleUnit from '~/lib/scale-unit'
import { LineAreaChart } from '~/components/charts'

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
  data: BalancePoint[]
  instrument: Instrument
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

// ─── Component ────────────────────────────────────────────────────────────────

export default function BalanceHistogram({ data, instrument }: BalanceHistogramProps) {
  const [range, setRange] = useState<BalanceHistoryRange>(DEFAULT_RANGE)
  const [period, setPeriod] = useState<BalanceHistoryPeriod>(DEFAULT_PERIOD)

  const { data: history, isFetching } = useQuery({
    queryKey: ['balance-history', instrument.id, range, period],
    queryFn: () => getBalanceHistory({ data: { instrumentId: instrument.id, range, period } }),
    initialData: range === DEFAULT_RANGE && period === DEFAULT_PERIOD ? data : undefined,
    placeholderData: (prev) => prev,
  })

  if (!history || history.length === 0) return null

  // For accounts in debt (e.g. credit cards), show the balance as negative
  // and pin the top of the y-axis at 0, so the line falls as debt grows.
  const isDebt = scaleUnit(history[history.length - 1].balance, instrument.exponent) < 0

  const points: ChartPoint[] = history.map((point) => ({
    period: new Date(point.period),
    balance: BigInt(point.balance),
    value: scaleUnit(point.balance, instrument.exponent),
    projected: point.projected,
  }))

  const yTickFormat = (value: number) => formatAxisValue(value, instrument.ticker)

  return (
    <section className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-6">
      <div className="flex items-center justify-between gap-4 mb-4 flex-wrap">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
          Balance History — {instrument.ticker}
        </h2>

        <div className="flex items-center gap-2">
          <SegmentedControl options={PERIOD_OPTIONS} value={period} onChange={setPeriod} />
          <SegmentedControl options={RANGE_OPTIONS} value={range} onChange={setRange} />
        </div>
      </div>

      <div className={isFetching ? 'opacity-60 transition-opacity' : 'transition-opacity'}>
        <LineAreaChart
          data={points}
          x={(d) => d.period}
          y={(d) => d.value}
          color={isDebt ? 'red' : 'blue'}
          yMax={isDebt ? 0 : undefined}
          zeroLine={!isDebt}
          isProjected={(d) => d.projected}
          numTicks={6}
          yTickFormat={yTickFormat}
          tickFormat={(date) =>
            period === 'month'
              ? date.toLocaleDateString('en-AU', { month: 'short', year: '2-digit' })
              : date.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })
          }
          renderTooltip={(d) => (
            <>
              <div className="font-medium">
                {d.period.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })}
              </div>
              <div className="tabular-nums">{formatBalance(d.balance, instrument)}</div>
              {d.projected && <div className="text-gray-400 dark:text-gray-500">No activity</div>}
            </>
          )}
        />
      </div>
    </section>
  )
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

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
