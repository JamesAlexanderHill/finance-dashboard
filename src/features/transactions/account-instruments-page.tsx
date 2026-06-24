import * as React from 'react'
import { createServerFn } from '@tanstack/react-start'
import { Link, useNavigate, useParams, useRouter } from '@tanstack/react-router'
import { accountService, instrumentService, getSession } from '~/db/services'
import { formatCurrency } from '~/lib/format-currency'
import { balanceColorClass } from '~/lib/format'
import PaginatedTable, { type ColumnDef } from '~/components/ui/table'

// ─── Server functions ─────────────────────────────────────────────────────────

const getData = createServerFn({ method: 'GET' })
  .inputValidator((data: unknown) => data as { accountId: string; page?: number; pageSize?: number })
  .handler(async ({ data }) => {
    const session = await getSession()
    if (!session) return { user: null, account: null, accountInstruments: null }

    const ctx = session.ctx
    const account = await accountService.getById(ctx, data.accountId)

    if (!account) return { user: session.user, account: null, accountInstruments: null }

    const page = data.page ?? 1
    const pageSize = data.pageSize ?? 20
    const offset = (page - 1) * pageSize

    const accountInstruments = await instrumentService.list(ctx, {
      accountIds: [data.accountId],
      limit: pageSize,
      offset,
    })

    return { user: session.user, account, accountInstruments }
  })

const createInstrument = createServerFn({ method: 'POST' })
  .inputValidator((data: unknown) => data as {
    accountId: string
    ticker: string
    name: string
    exponent: number
  })
  .handler(async ({ data }) => {
    const session = await getSession()
    if (!session) throw new Error('No user found')
    await instrumentService.create(session.ctx, {
      accountId: data.accountId,
      ticker: data.ticker,
      name: data.name,
      exponent: data.exponent,
    })
  })

export const accountInstrumentsLoader = getData

export type AccountInstrumentsPageData = Awaited<ReturnType<typeof getData>>

// ─── Component ────────────────────────────────────────────────────────────────

export function AccountInstrumentsPage(props: AccountInstrumentsPageData) {
  const { user, account, accountInstruments } = props
  const { accountId } = useParams({ strict: false }) as { accountId: string }
  const router = useRouter()
  const navigate = useNavigate()
  const [showCreate, setShowCreate] = React.useState(false)

  if (!user) {
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

  if (!account || !accountInstruments) {
    return (
      <div className="text-gray-500 dark:text-gray-400 text-sm">
        Account not found.{' '}
        <Link to="/accounts" className="text-blue-600 dark:text-blue-400 underline">
          Back to accounts
        </Link>
      </div>
    )
  }

  async function handleCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    await createInstrument({
      data: {
        accountId,
        ticker: String(fd.get('ticker')),
        name: String(fd.get('name')),
        exponent: parseInt(String(fd.get('exponent')), 10),
      },
    })
    setShowCreate(false)
    router.invalidate()
  }

  const sortedInstruments = [...accountInstruments.data].sort((a, b) => {
    if (a.id === account.defaultInstrumentId) return -1
    if (b.id === account.defaultInstrumentId) return 1
    return 0
  })

  const columns: ColumnDef<typeof accountInstruments.data[0]>[] = [
    {
      id: 'instrument',
      header: 'Instrument',
      cell: ({ row }) => {
        const isDefault = row.original.id === account.defaultInstrumentId
        return (
          <div>
            <span className="text-gray-900 dark:text-gray-100 font-medium">
              {row.original.ticker}
              {isDefault && (
                <span className="ml-2 text-xs px-1.5 py-0.5 rounded bg-blue-100 dark:bg-blue-950 text-blue-700 dark:text-blue-300">
                  Default
                </span>
              )}
            </span>
            <p className="text-xs text-gray-500 dark:text-gray-400">{row.original.name}</p>
          </div>
        )
      },
    },
    {
      id: 'balance',
      header: 'Balance',
      cell: ({ row }) => {
        const unitCount = BigInt(row.original.balance)
        return (
          <span
            className={[
              'font-medium tabular-nums',
              balanceColorClass(unitCount),
            ].join(' ')}
          >
            {formatCurrency(unitCount, {
              exponent: row.original.exponent,
              ticker: row.original.ticker,
            })}
          </span>
        )
      },
    },
  ];

  return (
    <div className="max-w-5xl">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400 mb-4">
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
        <span className="text-gray-900 dark:text-gray-100">Instruments</span>
      </div>

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">Instruments</h1>
        <div className="flex items-center gap-3">
          <span className="text-sm text-gray-500 dark:text-gray-400">
            {accountInstruments.pagination.total} instrument{accountInstruments.pagination.total !== 1 ? 's' : ''}
          </span>
          <button
            onClick={() => setShowCreate(true)}
            className="px-3 py-1.5 text-sm font-medium bg-blue-600 hover:bg-blue-700 text-white rounded-md transition-colors"
          >
            + New Instrument
          </button>
        </div>
      </div>

      {/* Create form */}
      {showCreate && (
        <form onSubmit={handleCreate} className="mb-6 p-4 bg-gray-50 dark:bg-gray-800 rounded-lg space-y-3">
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                Ticker
              </label>
              <input
                name="ticker"
                required
                placeholder="e.g., AUD, USD, VDAL"
                className="w-full px-3 py-1.5 text-sm border border-gray-200 dark:border-gray-700 rounded-md bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                Name
              </label>
              <input
                name="name"
                required
                placeholder="e.g., Australian Dollar"
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
                defaultValue={2}
                className="w-full px-3 py-1.5 text-sm border border-gray-200 dark:border-gray-700 rounded-md bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>
          <div className="flex gap-2">
            <button
              type="submit"
              className="px-3 py-1.5 text-sm font-medium bg-blue-600 hover:bg-blue-700 text-white rounded-md"
            >
              Create
            </button>
            <button
              type="button"
              onClick={() => setShowCreate(false)}
              className="px-3 py-1.5 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* Table */}
      <PaginatedTable
        data={sortedInstruments}
        columns={columns}
        pagination={accountInstruments.pagination}
        hidePagination={accountInstruments.pagination.total < accountInstruments.pagination.limit}
        onPaginationChange={(p) => navigate({ search: p })}
        onRowClick={(instrument) =>
          navigate({
            to: '/accounts/$accountId/instruments/$instrumentId',
            params: { accountId, instrumentId: instrument.id },
          })
        }
        getRowId={(row) => row.id}
      >
        <p>No instruments yet.</p>
      </PaginatedTable>
    </div>
  )
}
