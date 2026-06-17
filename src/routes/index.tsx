import * as React from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { accountService, instrumentService, rateService, getSession } from '~/db/services'
import { formatCurrency } from '~/lib/format-currency'
import { balanceColorClass } from '~/lib/format'
import BalanceHistogram, { type InstrumentRates } from '~/components/balance-histogram'
import type { AccountColorName } from '~/lib/chart-colors'

type AccountSummary = { id: string; color: AccountColorName | null }

// ─── Server functions ─────────────────────────────────────────────────────────

const getDashboardData = createServerFn({ method: 'GET' }).handler(async () => {
  const session = await getSession()
  if (!session) return { user: null, workspace: null, balances: [], instruments: [], accounts: [] as AccountSummary[], accountNames: {} as Record<string, string>, rates: {} as InstrumentRates }

  const { ctx, user, workspace } = session

  const [balances, accountsResult, instrumentsResult] = await Promise.all([
    instrumentService.getAccountBalances(ctx),
    accountService.list(ctx),
    instrumentService.list(ctx),
  ])

  const accountNames = Object.fromEntries(accountsResult.data.map((a) => [a.id, a.name]))
  const accounts: AccountSummary[] = accountsResult.data.map((a) => ({ id: a.id, color: a.color }))

  const ratesMap = await rateService.getRates(ctx, instrumentsResult.data.map((i) => i.id))
  const rates: InstrumentRates = Object.fromEntries(
    Array.from(ratesMap.entries()).map(([id, r]) => [id, { rate: r.rate, asOf: r.asOf.toISOString(), source: r.source }]),
  )

  return { user, workspace, balances, instruments: instrumentsResult.data, accounts, accountNames, rates }
})

// ─── Route ────────────────────────────────────────────────────────────────────

export const Route = createFileRoute('/')({
  loader: () => getDashboardData(),
  component: DashboardPage,
})

// ─── Component ────────────────────────────────────────────────────────────────

function DashboardPage() {
  const { user, workspace, balances, instruments, accounts, accountNames, rates } = Route.useLoaderData()

  if (!user || !workspace) {
    return (
      <div className="max-w-lg mx-auto mt-16 text-center">
        <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-2">
          No data yet
        </h1>
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

  // Group balances by account
  const byAccount = new Map<string, typeof balances>()
  for (const b of balances) {
    if (!byAccount.has(b.accountId)) byAccount.set(b.accountId, [])
    byAccount.get(b.accountId)!.push(b)
  }

  // Net worth: sum fiat balances in the user's home currency only
  const homeCurrency = user.homeCurrencyCode
  const homeBalances = balances.filter(
    (b) => b.instrumentTicker === homeCurrency,
  )
  const netWorthMinor = homeBalances.reduce((sum, b) => sum + b.unitCount, BigInt(0))
  const homeMinorUnit = homeBalances[0]?.instrumentExponent ?? 2

  return (
    <div className="max-w-4xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">Dashboard</h1>
        <span className="text-sm text-gray-500 dark:text-gray-400">{user.name}</span>
      </div>

      {/* Net worth */}
      <div className="mb-6 p-5 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl">
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-1">
          Net Worth ({homeCurrency})
        </p>
        <p
          className={[
            'text-3xl font-bold tabular-nums',
            balanceColorClass(netWorthMinor),
          ].join(' ')}
        >
          {formatCurrency(netWorthMinor, {
            exponent: homeMinorUnit,
            ticker: homeCurrency,
          })}
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
          />
        </div>
      )}

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
                  {accountBalances.map((b) => {
                    return (
                      <div key={b.instrumentId} className="flex items-center justify-between">
                        <span className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1">
                          {b.instrumentTicker}
                        </span>
                        <span
                          className={[
                            'text-sm font-medium tabular-nums',
                            balanceColorClass(b.unitCount),
                          ].join(' ')}
                        >
                          {formatCurrency(b.unitCount, {
                            exponent: b.instrumentExponent,
                            ticker: b.instrumentTicker,
                          })}
                        </span>
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
