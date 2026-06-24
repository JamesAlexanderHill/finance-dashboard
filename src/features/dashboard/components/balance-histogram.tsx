import { useState, useMemo } from 'react'
import { useQueries, useQuery } from '@tanstack/react-query'
import { createServerFn } from '@tanstack/react-start'
import { ParentSize } from '@visx/responsive'
import type { Instrument, RateSource, TimelineAnnotation } from '~/db/schema'
import type { BalanceHistoryPeriod, BalanceHistoryRange, BalancePoint } from '~/db/services'
import { instrumentService, sankeyService, categorySpendingService, getSession } from '~/db/services'
import { formatBalance } from '~/lib/format'
import { formatMajorAmount } from '~/lib/format-currency'
import scaleUnit from '~/lib/scale-unit'
import { defaultBalanceHistoryRange, rangesEqual, serializeRange, type DateRange } from '~/lib/date-range'
import { expandAnnotations } from '~/lib/timeline-annotations'
import { ACCOUNT_COLORS, resolveAccountColor, chartColorFor, type AccountColorName } from '~/lib/chart-colors'
import {
  LineAreaChart,
  StackedAreaChart,
  CategoryBarChart,
  buildCategoryColorMap,
  COLOR_CLASSES,
  type ChartColor,
  type ChartSeries,
  type TooltipPoint,
  type AnnotationMark,
  type StackedAreaDatum,
  type StackedAreaKey,
  type StackMode,
} from '~/components/charts'
import { SankeyChart } from '~/components/charts/sankey-chart'
import { Select, SelectTrigger, SelectValue, SelectPopup, SelectItem } from '~/components/ui/select'
import DateRangePicker from '~/components/ui/date-range-picker'

// ─── Server functions ─────────────────────────────────────────────────────────

const getBalanceHistory = createServerFn({ method: 'GET' })
  .inputValidator((data: unknown) => data as { instrumentId: string; range: BalanceHistoryRange; period: BalanceHistoryPeriod })
  .handler(async ({ data }) => {
    const session = await getSession()
    if (!session) return []
    return instrumentService.getBalanceHistory(session.ctx, data.instrumentId, data.range, data.period)
  })

const getCategoryFlow = createServerFn({ method: 'GET' })
  .inputValidator((d: unknown) => d as { start: string | null; end: string })
  .handler(async ({ data }) => {
    const session = await getSession()
    if (!session) return null
    return sankeyService.getData(session.ctx, data)
  })

const getCategoryBarData = createServerFn({ method: 'GET' })
  .inputValidator((d: unknown) => d as { start: string | null; end: string; period: BalanceHistoryPeriod })
  .handler(async ({ data }) => {
    const session = await getSession()
    if (!session) return null
    return categorySpendingService.getByPeriod(session.ctx, data, data.period)
  })

// ─── Types ────────────────────────────────────────────────────────────────────

/** 1 unit of the instrument = `rate` units of `homeCurrencyCode`. */
export type InstrumentRates = Record<string, { rate: number; asOf: string; source: RateSource }>

type BalanceHistogramProps = {
  instruments: (Instrument & { balance: string })[]
  /** Accounts the instruments belong to, in display order — used to derive each account's base chart hue. */
  accounts: { id: string; color: AccountColorName | null }[]
  defaultInstrumentId: string | null
  /** Pre-fetched 30D/daily history for `defaultInstrumentId`, from the route loader. */
  initialData: BalancePoint[]
  /** Current exchange/price rates, keyed by instrument id. */
  rates: InstrumentRates
  homeCurrencyCode: string
  /** Section heading. Defaults to "Balance History". */
  title?: string
  /** Label shown in the per-instrument toggle row and stacked-area tooltip. Defaults to the instrument's ticker — pass this to disambiguate instruments that share a ticker across accounts. */
  labelFor?: (instrument: Instrument) => string
  /** Initial chart view. Defaults to "line". */
  defaultView?: ChartViewType
  /** Timeline annotations for the account(s), pre-fetched by the route loader. */
  annotations?: TimelineAnnotation[]
}

type ChartPoint = {
  period: Date
  balance: bigint
  value: number
  projected: boolean
}

const DEFAULT_PERIOD: BalanceHistoryPeriod = 'day'

const PERIOD_OPTIONS: { value: BalanceHistoryPeriod; label: string }[] = [
  { value: 'day', label: 'Daily' },
  { value: 'week', label: 'Weekly' },
  { value: 'month', label: 'Monthly' },
]

type ChartViewType = 'line' | 'stacked' | 'category-bars' | 'sankey'

const DEFAULT_VIEW: ChartViewType = 'line'

const VIEW_OPTIONS: { value: ChartViewType; label: string }[] = [
  { value: 'line', label: 'Line' },
  { value: 'stacked', label: 'Stacked Area' },
  { value: 'category-bars', label: 'Category Bars' },
  { value: 'sankey', label: 'Sankey' },
]

const DEFAULT_STACK_MODE: StackMode = 'net'

const STACK_MODE_OPTIONS: { value: StackMode; label: string }[] = [
  { value: 'net', label: 'Net Balance' },
  { value: 'separated', label: 'Separated' },
]

// ─── Component ────────────────────────────────────────────────────────────────

export default function BalanceHistogram({
  instruments,
  accounts,
  defaultInstrumentId,
  initialData,
  rates,
  homeCurrencyCode,
  title = 'Balance History',
  labelFor = (instrument) => instrument.ticker,
  defaultView = DEFAULT_VIEW,
  annotations,
}: BalanceHistogramProps) {
  const [range, setRange] = useState<DateRange>(() => defaultBalanceHistoryRange())
  const [period, setPeriod] = useState<BalanceHistoryPeriod>(DEFAULT_PERIOD)
  const [view, setView] = useState<ChartViewType>(defaultView)
  const [stackMode, setStackMode] = useState<StackMode>(DEFAULT_STACK_MODE)
  const [visible, setVisible] = useState<Set<string>>(() => new Set(instruments.map((i) => i.id)))
  const [visibleAnnotations, setVisibleAnnotations] = useState<Set<string>>(
    () => new Set((annotations ?? []).map((a) => a.id)),
  )

  const accountColorByAccountId = new Map<string, AccountColorName>()
  accounts.forEach((account, index) => accountColorByAccountId.set(account.id, resolveAccountColor(account, index)))

  const shadeIndexByInstrumentId = new Map<string, number>()
  const nextShadeByAccountId = new Map<string, number>()
  for (const instrument of instruments) {
    const shade = nextShadeByAccountId.get(instrument.accountId) ?? 0
    shadeIndexByInstrumentId.set(instrument.id, shade)
    nextShadeByAccountId.set(instrument.accountId, shade + 1)
  }

  function colorForInstrument(instrument: Instrument): ChartColor {
    const accountColor = accountColorByAccountId.get(instrument.accountId) ?? ACCOUNT_COLORS[0]
    return chartColorFor(accountColor, shadeIndexByInstrumentId.get(instrument.id) ?? 0)
  }

  const expandedAnnotations = useMemo(() => {
    if (!annotations?.length) return []
    return expandAnnotations(annotations, range.start ?? new Date(0), range.end)
  }, [annotations, range])

  const filteredAnnotationMarks: AnnotationMark[] = useMemo(
    () =>
      expandedAnnotations
        .filter((ea) => visibleAnnotations.has(ea.annotation.id))
        .map((ea) => ({
          annotationId: ea.annotation.id,
          label: ea.annotation.label,
          occurrenceDate: ea.occurrenceDate,
          endDate: ea.endDate,
          color: ea.annotation.color,
        })),
    [expandedAnnotations, visibleAnnotations],
  )

  const serializedRange = serializeRange(range)

  const queries = useQueries({
    queries: instruments.map((instrument) => ({
      queryKey: ['balance-history', instrument.id, serializedRange, period],
      queryFn: () => getBalanceHistory({ data: { instrumentId: instrument.id, range: serializedRange, period } }),
      initialData:
        instrument.id === defaultInstrumentId && rangesEqual(range, defaultBalanceHistoryRange()) && period === DEFAULT_PERIOD
          ? initialData
          : undefined,
      placeholderData: (prev?: BalancePoint[]) => prev,
      enabled: visible.has(instrument.id) && (view === 'line' || view === 'stacked'),
    })),
  })

  const { data: categoryFlowData, isFetching: sankeyFetching } = useQuery({
    queryKey: ['category-flow', serializedRange.start, serializedRange.end],
    queryFn: () => getCategoryFlow({ data: { start: serializedRange.start, end: serializedRange.end } }),
    enabled: view === 'sankey',
    placeholderData: (prev) => prev,
  })

  const { data: categoryBarData, isFetching: barFetching } = useQuery({
    queryKey: ['category-bars', serializedRange.start, serializedRange.end, period],
    queryFn: () => getCategoryBarData({ data: { start: serializedRange.start, end: serializedRange.end, period } }),
    enabled: view === 'category-bars',
    placeholderData: (prev) => prev,
  })

  if (instruments.length === 0) return null

  const isBalanceView = view === 'line' || view === 'stacked'
  const isFetching = isBalanceView
    ? queries.some((q) => q.isFetching)
    : view === 'sankey'
    ? sankeyFetching
    : barFetching

  const series: ChartSeries<ChartPoint>[] = instruments
    .map((instrument, index): ChartSeries<ChartPoint> | null => {
      if (!visible.has(instrument.id)) return null
      const history = queries[index].data
      if (!history || history.length === 0) return null

      const rate = rateFor(instrument, homeCurrencyCode, rates)
      const data: ChartPoint[] = history.map((point) => ({
        period: new Date(point.period),
        balance: BigInt(point.balance),
        value: scaleUnit(point.balance, instrument.exponent) * rate,
        projected: point.projected,
      }))

      return {
        id: instrument.id,
        data,
        color: colorForInstrument(instrument),
        isProjected: (d: ChartPoint) => d.projected,
      }
    })
    .filter((s): s is ChartSeries<ChartPoint> => s !== null)

  const yTickFormat = (value: number) => formatMajorAmount(value, homeCurrencyCode, { compact: true })

  const tickFormat = (date: Date) =>
    period === 'month'
      ? date.toLocaleDateString('en-AU', { month: 'short', year: '2-digit' })
      : date.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })

  const stackedKeys: StackedAreaKey[] = series.map((s) => ({ id: s.id, color: s.color }))
  const stackedData: StackedAreaDatum[] = buildStackedData(series)

  const barTickFormat = (period: string) => {
    const d = new Date(period + 'T00:00:00Z')
    if (period.endsWith('-01') || period.length === 7) {
      return d.toLocaleDateString('en-AU', { month: 'short', year: '2-digit', timeZone: 'UTC' })
    }
    return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', timeZone: 'UTC' })
  }

  const catColorMap = categoryBarData?.categories
    ? buildCategoryColorMap(categoryBarData.categories)
    : new Map<string, string>()

  function toggle(instrumentId: string) {
    setVisible((prev) => {
      const next = new Set(prev)
      if (next.has(instrumentId)) next.delete(instrumentId)
      else next.add(instrumentId)
      return next
    })
  }

  function toggleAnnotation(annotationId: string) {
    setVisibleAnnotations((prev) => {
      const next = new Set(prev)
      if (next.has(annotationId)) next.delete(annotationId)
      else next.add(annotationId)
      return next
    })
  }

  const isSankeyEmpty = !categoryFlowData || categoryFlowData.nodes.length === 0
  const isBarsEmpty = !categoryBarData || categoryBarData.data.length === 0

  return (
    <section className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-6">
      <div className="flex items-center justify-between gap-4 mb-4 flex-wrap">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">{title}</h2>

        <div className="flex items-center gap-2">
          {view !== 'sankey' && (
            <SegmentedControl options={PERIOD_OPTIONS} value={period} onChange={setPeriod} />
          )}
          <DateRangePicker value={range} onChange={setRange} />
          {view === 'stacked' && (
            <SegmentedControl options={STACK_MODE_OPTIONS} value={stackMode} onChange={setStackMode} />
          )}
          <Select items={VIEW_OPTIONS} value={view} onValueChange={(value) => setView(value as ChartViewType)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectPopup>
              {VIEW_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        </div>
      </div>

      {/* Instrument legend — only shown for balance views */}
      {isBalanceView && instruments.length > 1 && (
        <div className="flex items-center gap-3 mb-4 flex-wrap">
          {instruments.map((instrument) => {
            const color = colorForInstrument(instrument)
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
                {labelFor(instrument)}
              </label>
            )
          })}
        </div>
      )}

      {/* Category legend — shown for category views */}
      {view === 'category-bars' && categoryBarData && categoryBarData.categories.length > 0 && (
        <div className="flex items-center gap-3 mb-4 flex-wrap">
          {categoryBarData.categories.map((cat) => (
            <span key={cat.id} className="inline-flex items-center gap-1.5 text-xs text-gray-700 dark:text-gray-300">
              <span
                className="inline-block w-2.5 h-2.5 rounded-sm"
                style={{ backgroundColor: catColorMap.get(cat.id) ?? '#888', opacity: 0.85 }}
              />
              {cat.name}
              <span className="text-gray-400 dark:text-gray-500">{cat.isIncome ? '↑' : '↓'}</span>
            </span>
          ))}
        </div>
      )}

      {annotations && annotations.length > 0 && isBalanceView && (
        <div className="flex items-center gap-3 mb-4 flex-wrap">
          <span className="text-xs text-gray-400 dark:text-gray-500 font-medium">Annotations:</span>
          {annotations.map((annotation) => {
            const checked = visibleAnnotations.has(annotation.id)
            return (
              <label
                key={annotation.id}
                className={`inline-flex items-center gap-1.5 text-xs cursor-pointer select-none ${
                  checked ? 'text-gray-700 dark:text-gray-300' : 'text-gray-400 dark:text-gray-500'
                }`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggleAnnotation(annotation.id)}
                  className="sr-only"
                />
                <span
                  className={`inline-block w-4 border-t border-dashed ${
                    checked ? 'border-amber-400 dark:border-amber-500' : 'border-gray-300 dark:border-gray-700'
                  }`}
                />
                {annotation.label}
                {annotation.recurrence && (
                  <span className="text-gray-400 dark:text-gray-500">({annotation.recurrence.frequency})</span>
                )}
              </label>
            )
          })}
        </div>
      )}

      <div className={isFetching ? 'opacity-60 transition-opacity' : 'transition-opacity'}>
        {view === 'sankey' ? (
          isSankeyEmpty ? (
            <EmptyState message="No categorized transactions in this date range." />
          ) : (
            <div style={{ height: Math.max(280, Math.min(480, (categoryFlowData!.nodes.length ?? 4) * 52)) }}>
              <ParentSize>
                {({ width }) => (
                  <SankeyChart
                    width={width}
                    height={Math.max(280, Math.min(480, (categoryFlowData!.nodes.length ?? 4) * 52))}
                    nodes={categoryFlowData!.nodes}
                    links={categoryFlowData!.links}
                  />
                )}
              </ParentSize>
            </div>
          )
        ) : view === 'category-bars' ? (
          isBarsEmpty ? (
            <EmptyState message="No categorized transactions in this date range." />
          ) : (
            <CategoryBarChart
              categories={categoryBarData!.categories}
              data={categoryBarData!.data}
              height={200}
              tickFormat={barTickFormat}
              yTickFormat={yTickFormat}
              renderTooltip={(datum) => (
                <>
                  <div className="font-medium mb-1">{barTickFormat(datum.period)}</div>
                  {categoryBarData!.categories.map((cat) => {
                    const v = datum.amounts[cat.id] ?? 0
                    if (v === 0) return null
                    return (
                      <div key={cat.id} className="flex items-center gap-1.5 tabular-nums">
                        <span
                          className="inline-block w-2 h-2 rounded-sm"
                          style={{ backgroundColor: catColorMap.get(cat.id) ?? '#888' }}
                        />
                        <span className="text-gray-500 dark:text-gray-400">{cat.name}</span>
                        <span className={v >= 0 ? 'text-green-600 dark:text-green-400' : ''}>
                          {formatMajorAmount(Math.abs(v), homeCurrencyCode)}
                          {v >= 0 ? ' ↑' : ' ↓'}
                        </span>
                      </div>
                    )
                  })}
                </>
              )}
            />
          )
        ) : series.length > 0 ? (
          view === 'stacked' ? (
            <StackedAreaChart
              data={stackedData}
              keys={stackedKeys}
              stackMode={stackMode}
              numTicks={6}
              yTickFormat={yTickFormat}
              tickFormat={tickFormat}
              annotations={filteredAnnotationMarks}
              renderTooltip={(datum) => (
                <>
                  <div className="font-medium">
                    {datum.period.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </div>
                  {stackedKeys.map((key) => {
                    const instrument = instruments.find((i) => i.id === key.id)
                    if (!instrument) return null
                    return (
                      <div key={key.id} className="flex items-center gap-1.5 tabular-nums">
                        <span className={`inline-block w-2 h-2 rounded-full ${COLOR_CLASSES[key.color].bg}`} />
                        <span>{labelFor(instrument)}</span>
                        <span>{formatMajorAmount(datum.values[key.id] ?? 0, homeCurrencyCode)}</span>
                      </div>
                    )
                  })}
                  {stackedKeys.length > 1 && (
                    <div className="font-medium tabular-nums border-t border-gray-200 dark:border-gray-700 mt-1 pt-1">
                      Total: {formatMajorAmount(Object.values(datum.values).reduce((a, b) => a + b, 0), homeCurrencyCode)}
                    </div>
                  )}
                </>
              )}
            />
          ) : (
            <LineAreaChart
              series={series}
              x={(d) => d.period}
              y={(d) => d.value}
              numTicks={6}
              yTickFormat={yTickFormat}
              tickFormat={tickFormat}
              annotations={filteredAnnotationMarks}
              renderTooltip={(points) => (
                <>
                  <div className="font-medium">
                    {points[0].point.period.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </div>
                  {points.map((p) => (
                    <TooltipRow key={p.seriesId} point={p} instruments={instruments} homeCurrencyCode={homeCurrencyCode} labelFor={labelFor} />
                  ))}
                </>
              )}
            />
          )
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

function EmptyState({ message }: { message: string }) {
  return (
    <p className="text-sm text-gray-500 dark:text-gray-400 py-8 text-center">{message}</p>
  )
}

function TooltipRow({
  point,
  instruments,
  homeCurrencyCode,
  labelFor,
}: {
  point: TooltipPoint<ChartPoint>
  instruments: Instrument[]
  homeCurrencyCode: string
  labelFor: (instrument: Instrument) => string
}) {
  const instrument = instruments.find((i) => i.id === point.seriesId)
  if (!instrument) return null

  const label = labelFor(instrument)

  return (
    <div className="flex items-center gap-1.5 tabular-nums">
      <span className={`inline-block w-2 h-2 rounded-full ${COLOR_CLASSES[point.color].bg}`} />
      {label !== instrument.ticker && <span className="text-gray-500 dark:text-gray-400">{label}</span>}
      <span>{formatBalance(point.point.balance, instrument)}</span>
      {instrument.ticker !== homeCurrencyCode && (
        <span className="text-gray-400 dark:text-gray-500">({formatMajorAmount(point.point.value, homeCurrencyCode)})</span>
      )}
      {point.point.projected && <span className="text-gray-400 dark:text-gray-500">(no activity)</span>}
    </div>
  )
}

function rateFor(instrument: Instrument, homeCurrencyCode: string, rates: InstrumentRates): number {
  if (instrument.ticker === homeCurrencyCode) return 1
  return rates[instrument.id]?.rate ?? 1
}

function buildStackedData(series: ChartSeries<ChartPoint>[]): StackedAreaDatum[] {
  const allTimes = new Set<number>()
  for (const s of series) {
    for (const d of s.data) allTimes.add(d.period.getTime())
  }
  const sortedTimes = [...allTimes].sort((a, b) => a - b)

  return sortedTimes.map((time) => {
    const values: Record<string, number> = {}
    for (const s of series) {
      let value = 0
      for (const d of s.data) {
        if (d.period.getTime() > time) break
        value = d.value
      }
      values[s.id] = value
    }
    return { period: new Date(time), values }
  })
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
