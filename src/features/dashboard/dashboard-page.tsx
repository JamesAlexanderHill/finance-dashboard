import * as React from 'react'
import { createServerFn } from '@tanstack/react-start'
import { useQuery } from '@tanstack/react-query'
import { ParentSize } from '@visx/responsive'
import {
  accountService,
  annotationService,
  instrumentService,
  rateService,
  sankeyService,
  getSession,
} from '~/db/services'
import { formatCurrency } from '~/lib/format-currency'
import { balanceColorClass } from '~/lib/format'
import BalanceHistogram, { type InstrumentRates } from '~/features/dashboard/components/balance-histogram'
import { SankeyChart } from '~/components/charts/sankey-chart'
import type { AccountColorName } from '~/lib/chart-colors'
import {
  todayUTC,
  startOfMonth,
  startOfFinancialYear,
  addMonths,
  toISODate,
} from '~/lib/date-range'

type AccountSummary = { id: string; color: AccountColorName | null }

// ─── Server functions ─────────────────────────────────────────────────────────

const getDashboardData = createServerFn({ method: 'GET' }).handler(async () => {
  const session = await getSession()
  if (!session)
    return {
      user: null,
      workspace: null,
      balances: [],
      instruments: [],
      accounts: [] as AccountSummary[],
      accountNames: {} as Record<string, string>,
      rates: {} as InstrumentRates,
      annotations: [],
    }

  const { ctx, user, workspace } = session

  const [balances, accountsResult, instrumentsResult, annotations] = await Promise.all([
    instrumentService.getAccountBalances(ctx),
    accountService.list(ctx),
    instrumentService.list(ctx),
    annotationService.listByWorkspace(ctx),
  ])

  const accountNames = Object.fromEntries(accountsResult.data.map((a) => [a.id, a.name]))
  const accounts: AccountSummary[] = accountsResult.data.map((a) => ({ id: a.id, color: a.color }))

  const ratesMap = await rateService.getRates(
    ctx,
    instrumentsResult.data.map((i) => i.id),
  )
  const rates: InstrumentRates = Object.fromEntries(
    Array.from(ratesMap.entries()).map(([id, r]) => [
      id,
      { rate: r.rate, asOf: r.asOf.toISOString(), source: r.source },
    ]),
  )

  return { user, workspace, balances, instruments: instrumentsResult.data, accounts, accountNames, rates, annotations }
})

const getSankeyWidgetData = createServerFn({ method: 'GET' })
  .inputValidator((d: unknown) => d as { start: string | null; end: string })
  .handler(async ({ data }) => {
    const session = await getSession()
    if (!session) return null
    return sankeyService.getData(session.ctx, { start: data.start, end: data.end })
  })

// ─── Loader ───────────────────────────────────────────────────────────────────

export const dashboardLoader = () => getDashboardData()

export type DashboardPageData = Awaited<ReturnType<typeof getDashboardData>>

// ─── Sankey periods ───────────────────────────────────────────────────────────

type SankeyPeriod = { label: string; start: string | null; end: string }

function getSankeyPeriods(): SankeyPeriod[] {
  const today = todayUTC()
  return [
    { label: 'This month', start: toISODate(startOfMonth(today)), end: toISODate(today) },
    { label: 'This FY', start: toISODate(startOfFinancialYear(today)), end: toISODate(today) },
    { label: 'Last 12 months', start: toISODate(addMonths(today, -12)), end: toISODate(today) },
    { label: 'All time', start: null, end: toISODate(today) },
  ]
}

// ─── Component ────────────────────────────────────────────────────────────────

export function DashboardPage({
  user,
  workspace,
  balances,
  instruments,
  accounts,
  accountNames,
  rates,
  annotations,
}: DashboardPageData) {
  const periods = React.useMemo(() => getSankeyPeriods(), [])
  const [selectedPeriod, setSelectedPeriod] = React.useState<SankeyPeriod>(
    () => periods.find((p) => p.label === 'This FY') ?? periods[1],
  )

  const { data: sankeyData } = useQuery({
    queryKey: ['sankey-widget', selectedPeriod.start, selectedPeriod.end],
    queryFn: () =>
      getSankeyWidgetData({ data: { start: selectedPeriod.start, end: selectedPeriod.end } }),
    enabled: !!user,
  })

  if (!user || !workspace) {
    return (
      <div className="max-w-lg mx-auto mt-16 text-center">
        <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-2">No data yet</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
          Use the{' '}
          <a href="/dev" className="text-blue-600 dark:text-blue-400 underline">
            Dev Tools
          </a>{' '}
          page to seed a demo user.
        </p>
      </div>
    )
  }

  const byAccount = new Map<string, typeof balances>()
  for (const b of balances) {
    if (!byAccount.has(b.accountId)) byAccount.set(b.accountId, [])
    byAccount.get(b.accountId)!.push(b)
  }

  const homeCurrency = user.homeCurrencyCode
  const homeBalances = balances.filter((b) => b.instrumentTicker === homeCurrency)
  const netWorthMinor = homeBalances.reduce((sum, b) => sum + b.unitCount, BigInt(0))
  const homeMinorUnit = homeBalances[0]?.instrumentExponent ?? 2

  const isSankeyEmpty = !sankeyData || sankeyData.nodes.length === 0

  const fmtAUD = (n: number) =>
    n.toLocaleString('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 })

  return (
    <div className="max-w-5xl">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">Dashboard</h1>
        <span className="text-sm text-gray-500 dark:text-gray-400">{user.name}</span>
      </div>

      {/* Net worth */}
      <div className="mb-6 p-5 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl">
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-1">Net Worth ({homeCurrency})</p>
        <p className={['text-3xl font-bold tabular-nums', balanceColorClass(netWorthMinor)].join(' ')}>
          {formatCurrency(netWorthMinor, { exponent: homeMinorUnit, ticker: homeCurrency })}
        </p>
        <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
          {homeCurrency} fiat balances only — no cross-currency conversion
        </p>
      </div>

      {/* Net worth history */}
      {instruments.length > 0 && (
        <div className="mb-6">
          <BalanceHistogram
            instruments={instruments}
            accounts={accounts}
            defaultInstrumentId={null}
            initialData={[]}
            rates={rates}
            homeCurrencyCode={homeCurrency}
            title="Net Worth History"
            labelFor={(instrument) => {
              const accountName = accountNames[instrument.accountId]
              return accountName ? `${accountName} ${instrument.ticker}` : instrument.ticker
            }}
            defaultView="stacked"
            annotations={annotations}
          />
        </div>
      )}

      {/* Cash flow Sankey */}
      <div className="mb-6 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-sm font-medium text-gray-900 dark:text-gray-100">Cash Flow</h2>
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
              Income → expense flows by category
            </p>
          </div>
          <div className="flex gap-1">
            {periods.map((p) => (
              <button
                key={p.label}
                onClick={() => setSelectedPeriod(p)}
                className={[
                  'px-2.5 py-1 text-xs rounded-md font-medium transition-colors',
                  selectedPeriod.label === p.label
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700',
                ].join(' ')}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {!isSankeyEmpty && (
          <div className="grid grid-cols-3 gap-3 mb-4">
            <div className="bg-gray-50 dark:bg-gray-800/50 rounded-lg p-3">
              <p className="text-xs text-gray-400 dark:text-gray-500 mb-0.5">Income</p>
              <p className="text-base font-semibold tabular-nums text-green-600 dark:text-green-400">
                {fmtAUD(sankeyData!.totalIncome)}
              </p>
            </div>
            <div className="bg-gray-50 dark:bg-gray-800/50 rounded-lg p-3">
              <p className="text-xs text-gray-400 dark:text-gray-500 mb-0.5">Expenses</p>
              <p className="text-base font-semibold tabular-nums text-red-600 dark:text-red-400">
                {fmtAUD(sankeyData!.totalExpense)}
              </p>
            </div>
            <div className="bg-gray-50 dark:bg-gray-800/50 rounded-lg p-3">
              <p className="text-xs text-gray-400 dark:text-gray-500 mb-0.5">Net</p>
              <p className={['text-base font-semibold tabular-nums', sankeyData!.totalIncome >= sankeyData!.totalExpense ? 'text-blue-600 dark:text-blue-400' : 'text-red-600 dark:text-red-400'].join(' ')}>
                {fmtAUD(sankeyData!.totalIncome - sankeyData!.totalExpense)}
              </p>
            </div>
          </div>
        )}

        {isSankeyEmpty ? (
          <div className="flex flex-col items-center justify-center py-12 gap-2">
            <p className="text-gray-500 dark:text-gray-400 text-sm">
              No categorized transactions for this period.
            </p>
            <p className="text-gray-400 dark:text-gray-500 text-xs">
              Assign categories to transaction legs via the Events page.
            </p>
          </div>
        ) : (
          <ParentSize>
            {({ width }) => (
              <SankeyChart
                width={width}
                height={Math.max(300, Math.min(520, (sankeyData?.nodes.length ?? 4) * 55))}
                nodes={sankeyData!.nodes}
                links={sankeyData!.links}
              />
            )}
          </ParentSize>
        )}
      </div>

      {/* Account balance cards */}
      {balances.length === 0 ? (
        <p className="text-gray-500 dark:text-gray-400 text-sm">
          No transactions yet. Import a CSV to get started.
        </p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from(byAccount.entries()).map(([accountId, accountBalances]) => {
            const accountName = accountBalances[0].accountName
            return (
              <div
                key={accountId}
                className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4"
              >
                <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
                  {accountName}
                </p>
                <div className="space-y-1.5">
                  {accountBalances.map((b) => (
                    <div key={b.instrumentId} className="flex items-center justify-between">
                      <span className="text-xs text-gray-500 dark:text-gray-400">
                        {b.instrumentTicker}
                      </span>
                      <span className={['text-sm font-medium tabular-nums', balanceColorClass(b.unitCount)].join(' ')}>
                        {formatCurrency(b.unitCount, {
                          exponent: b.instrumentExponent,
                          ticker: b.instrumentTicker,
                        })}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
