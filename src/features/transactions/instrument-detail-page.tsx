import * as React from 'react'
import { createServerFn } from '@tanstack/react-start'
import { Link, useNavigate, useParams, useRouter } from '@tanstack/react-router'
import { formatCurrency, formatMajorAmount } from '~/lib/format-currency'
import { balanceColorClass } from '~/lib/format'
import scaleUnit from '~/lib/scale-unit'
import Badge from '~/components/ui/badge'
import { accountService, eventService, instrumentService, rateService, getSession } from '~/db/services'
import EventTable from '~/features/transactions/components/event/event-table'

const DEFAULT_PAGE_SIZE = 10

// ─── Server functions ─────────────────────────────────────────────────────────

const getData = createServerFn({ method: 'GET' })
  .inputValidator((data: unknown) => data as { page?: number, pageSize?: number, accountId: string; instrumentId: string })
  .handler(async ({ data }) => {
    const session = await getSession()
    if (!session) return { user: null, workspace: null, account: null, instrument: null, balance: BigInt(0), instrumentEvents: null, rate: null }

    const { ctx, user, workspace } = session
    const account = await accountService.getById(ctx, data.accountId)

    if (!account) return { user, workspace, account: null, instrument: null, balance: BigInt(0), instrumentEvents: null, rate: null }

    const instrument = await instrumentService.getById(ctx, data.instrumentId)

    if (!instrument) return { user, workspace, account, instrument: null, balance: BigInt(0), instrumentEvents: null, rate: null }

    const page = data.page ?? 1
    const pageSize = data.pageSize ?? DEFAULT_PAGE_SIZE
    const offset = (page - 1) * pageSize

    const [balance, instrumentEvents, currentRate] = await Promise.all([
      instrumentService.getBalance(ctx, data.instrumentId),
      eventService.listByInstrument(ctx, data.instrumentId, { limit: pageSize, offset }),
      rateService.getRate(ctx, data.instrumentId),
    ])

    const rate = currentRate ? { rate: currentRate.rate, asOf: currentRate.asOf.toISOString(), source: currentRate.source } : null

    return { user, workspace, account, instrument, balance, instrumentEvents, rate }
  })

const updateInstrument = createServerFn({ method: 'POST' })
  .inputValidator((data: unknown) => data as {
    instrumentId: string
    name: string
    exponent: number
  })
  .handler(async ({ data }) => {
    const session = await getSession()
    if (!session) throw new Error('No user found')
    await instrumentService.update(session.ctx, data.instrumentId, {
      name: data.name,
      exponent: data.exponent,
    })
  })

const setInstrumentRate = createServerFn({ method: 'POST' })
  .inputValidator((data: unknown) => data as { instrumentId: string; rate: number })
  .handler(async ({ data }) => {
    const session = await getSession()
    if (!session) throw new Error('No user found')
    await rateService.setManualRate(session.ctx, data.instrumentId, data.rate)
  })

export const instrumentDetailLoader = getData

export type InstrumentDetailPageData = Awaited<ReturnType<typeof getData>>

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(d: Date | string) {
  return new Date(d).toLocaleDateString('en-AU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

// ─── Component ────────────────────────────────────────────────────────────────

export function InstrumentDetailPage(props: InstrumentDetailPageData) {
  const { user, workspace, account, instrument, balance, instrumentEvents, rate } = props
  const { accountId, instrumentId } = useParams({ strict: false }) as { accountId: string; instrumentId: string }
  const router = useRouter()
  const navigate = useNavigate()
  const [editing, setEditing] = React.useState(false)
  const [editingRate, setEditingRate] = React.useState(false)

  if (!user || !workspace) {
    return (
      <div className="text-gray-500 dark:text-gray-400 text-sm">
        No user found. Visit{' '}
        <a href="/dev" className="text-blue-600 dark:text-blue-400 underline">
          Dev Tools
        </a>{' '}
        to seed data.
      </div>
    )
  }

  if (!account) {
    return (
      <div className="text-gray-500 dark:text-gray-400 text-sm">
        Account not found.{' '}
        <Link to="/accounts" className="text-blue-600 dark:text-blue-400 underline">
          Back to accounts
        </Link>
      </div>
    )
  }

  if (!instrument || !instrumentEvents) {
    return (
      <div className="text-gray-500 dark:text-gray-400 text-sm">
        Instrument not found.{' '}
        <Link
          to="/accounts/$accountId/instruments"
          params={{ accountId }}
          className="text-blue-600 dark:text-blue-400 underline"
        >
          Back to instruments
        </Link>
      </div>
    )
  }

  async function handleUpdate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    await updateInstrument({
      data: {
        instrumentId,
        name: String(fd.get('name')),
        exponent: parseInt(String(fd.get('exponent')), 10),
      },
    })
    setEditing(false)
    router.invalidate()
  }

  async function handleUpdateRate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    await setInstrumentRate({
      data: {
        instrumentId,
        rate: parseFloat(String(fd.get('rate'))),
      },
    })
    setEditingRate(false)
    router.invalidate()
  }

  const isHomeCurrency = instrument.ticker === user!.homeCurrencyCode
  const effectiveRate = rate?.rate ?? 1

  return (
    <div className="max-w-4xl space-y-8">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400 mb-2">
          <Link to="/accounts" className="hover:text-blue-600 dark:hover:text-blue-400">
            Accounts
          </Link>
          <span>/</span>
          <Link
            to="/accounts/$accountId"
            params={{ accountId }}
            className="hover:text-blue-600 dark:hover:text-blue-400"
          >
            {account.name}
          </Link>
          <span>/</span>
          <Link
            to="/accounts/$accountId/instruments"
            params={{ accountId }}
            className="hover:text-blue-600 dark:hover:text-blue-400"
          >
            Instruments
          </Link>
          <span>/</span>
          <span className="text-gray-900 dark:text-gray-100">{instrument.ticker}</span>
        </div>

        {editing ? (
          <form onSubmit={handleUpdate} className="p-4 bg-gray-50 dark:bg-gray-800 rounded-lg space-y-3 max-w-md">
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                Code (read-only)
              </label>
              <input
                value={instrument.ticker}
                disabled
                className="w-full px-3 py-1.5 text-sm border border-gray-200 dark:border-gray-700 rounded-md bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                Name
              </label>
              <input
                name="name"
                defaultValue={instrument.name}
                required
                className="w-full px-3 py-1.5 text-sm border border-gray-200 dark:border-gray-700 rounded-md bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                Exponent (decimal places)
              </label>
              <input
                name="exponent"
                type="number"
                min={0}
                max={8}
                defaultValue={instrument.exponent}
                className="w-full px-3 py-1.5 text-sm border border-gray-200 dark:border-gray-700 rounded-md bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div className="flex gap-2">
              <button
                type="submit"
                className="px-3 py-1.5 text-sm font-medium bg-blue-600 hover:bg-blue-700 text-white rounded-md"
              >
                Save
              </button>
              <button
                type="button"
                onClick={() => setEditing(false)}
                className="px-3 py-1.5 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100"
              >
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <div className="flex items-start justify-between">
            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">{instrument.ticker}</h1>
                {account.defaultInstrumentId === instrument.id ? (<Badge>Default</Badge>) : null}
              </div>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{instrument.name}</p>
              <p
                className={[
                  'mt-3 text-2xl font-bold tabular-nums',
                  balanceColorClass(balance),
                ].join(' ')}
              >
                {formatCurrency(balance, {
                  exponent: instrument.exponent,
                  ticker: instrument.ticker,
                })}
                <span className="text-base font-normal text-gray-500 dark:text-gray-400 ml-2">
                  balance
                </span>
              </p>
            </div>
            <button
              onClick={() => setEditing(true)}
              className="px-3 py-1.5 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 border border-gray-200 dark:border-gray-700 rounded-md"
            >
              Edit
            </button>
          </div>
        )}
      </div>

      {/* Current Value / Exchange Rate */}
      {!isHomeCurrency && (
        <section className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-6">
          {editingRate ? (
            <form onSubmit={handleUpdateRate} className="space-y-3 max-w-sm">
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                  1 {instrument.ticker} = ? {user!.homeCurrencyCode}
                </label>
                <input
                  name="rate"
                  type="number"
                  step="0.0001"
                  min="0"
                  defaultValue={effectiveRate}
                  required
                  className="w-full px-3 py-1.5 text-sm border border-gray-200 dark:border-gray-700 rounded-md bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div className="flex gap-2">
                <button
                  type="submit"
                  className="px-3 py-1.5 text-sm font-medium bg-blue-600 hover:bg-blue-700 text-white rounded-md"
                >
                  Save
                </button>
                <button
                  type="button"
                  onClick={() => setEditingRate(false)}
                  className="px-3 py-1.5 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100"
                >
                  Cancel
                </button>
              </div>
            </form>
          ) : (
            <div className="flex items-start justify-between">
              <div>
                <p className="text-2xl font-bold tabular-nums text-gray-900 dark:text-gray-100">
                  {formatMajorAmount(scaleUnit(balance, instrument.exponent) * effectiveRate, user!.homeCurrencyCode)}
                  <span className="text-base font-normal text-gray-500 dark:text-gray-400 ml-2">
                    current value
                  </span>
                </p>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                  1 {instrument.ticker} = {effectiveRate} {user!.homeCurrencyCode}
                  {rate && (
                    <span className="text-gray-400 dark:text-gray-500">
                      {' '}({rate.source === 'manual' ? 'manually set' : 'from transactions'}, as of {formatDate(rate.asOf)})
                    </span>
                  )}
                </p>
              </div>
              <button
                onClick={() => setEditingRate(true)}
                className="px-3 py-1.5 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 border border-gray-200 dark:border-gray-700 rounded-md whitespace-nowrap"
              >
                Update price
              </button>
            </div>
          )}
        </section>
      )}

      {/* Recent Events */}
      <section>
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">Events</h2>
          <span className="text-sm text-gray-500 dark:text-gray-400">
            {instrumentEvents.pagination.total} event{instrumentEvents.pagination.total !== 1 ? 's' : ''}
          </span>
        </div>
        <EventTable
          events={instrumentEvents.data}
          pagination={instrumentEvents.pagination}
          onPaginationChange={(p) => navigate({ search: p })}
          onRowClick={(event) => navigate({ search: (prev) => ({ ...(prev as object), viewEvent: event.id }) })}
        />
      </section>
    </div>
  )
}
