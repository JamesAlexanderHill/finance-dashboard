import * as React from 'react'
import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { eq, and, sql } from 'drizzle-orm'
import { db } from '~/db'
import { users, accounts, instruments } from '~/db/schema'
import { getUserBalances } from '~/lib/balance'
import { formatCurrency } from '~/lib/format-currency'
import PaginatedTable, { type ColumnDef } from '~/components/paginated-table'

// ─── Server functions ─────────────────────────────────────────────────────────

const getInstrumentsData = createServerFn({ method: 'GET' })
  .inputValidator((data: unknown) => data as { accountId: string; page?: number; pageSize?: number })
  .handler(async ({ data }) => {
    const [user] = await db.select().from(users).limit(1)
    if (!user) return { user: null, account: null, instruments: [], balances: [], totalCount: 0, page: 1, pageSize: 20 }

    const [account] = await db
      .select()
      .from(accounts)
      .where(and(eq(accounts.id, data.accountId), eq(accounts.userId, user.id)))

    if (!account) return { user, account: null, instruments: [], balances: [], totalCount: 0, page: 1, pageSize: 20 }

    const page = data.page ?? 1
    const pageSize = data.pageSize ?? 20
    const offset = (page - 1) * pageSize

    const [accountInstruments, allBalances, countResult] = await Promise.all([
      db
        .select()
        .from(instruments)
        .where(eq(instruments.accountId, data.accountId))
        .limit(pageSize)
        .offset(offset),
      getUserBalances(user.id),
      db
        .select({ count: sql<number>`count(*)` })
        .from(instruments)
        .where(eq(instruments.accountId, data.accountId)),
    ])

    const balances = allBalances.filter((b) => b.accountId === data.accountId)

    return {
      user,
      account,
      instruments: accountInstruments,
      balances,
      totalCount: Number(countResult[0]?.count ?? 0),
      page,
      pageSize,
    }
  })

const createInstrument = createServerFn({ method: 'POST' })
  .inputValidator((data: unknown) => data as {
    accountId: string
    ticker: string
    name: string
    exponent: number
  })
  .handler(async ({ data }) => {
    const [user] = await db.select().from(users).limit(1)
    if (!user) throw new Error('No user found')

    const [account] = await db
      .select()
      .from(accounts)
      .where(and(eq(accounts.id, data.accountId), eq(accounts.userId, user.id)))

    if (!account) throw new Error('Account not found')

    await db.insert(instruments).values({
      userId: user.id,
      accountId: data.accountId,
      ticker: data.ticker.trim().toUpperCase(),
      name: data.name.trim(),
      exponent: data.exponent,
    })
  })

// ─── Route ────────────────────────────────────────────────────────────────────

const DEFAULT_PAGE_SIZE = 20

interface InstrumentsSearch {
  page?: number
  pageSize?: number
}

export const Route = createFileRoute('/accounts/$accountId/instruments/')({
  validateSearch: (search: Record<string, unknown>): InstrumentsSearch => ({
    page: typeof search.page === 'number' ? search.page : 1,
    pageSize: typeof search.pageSize === 'number' ? search.pageSize : DEFAULT_PAGE_SIZE,
  }),
  loaderDeps: ({ search }) => ({ page: search.page, pageSize: search.pageSize }),
  loader: ({ params, deps }) =>
    getInstrumentsData({ data: { accountId: params.accountId, page: deps.page, pageSize: deps.pageSize } }),
  component: InstrumentsPage,
})

// ─── Component ────────────────────────────────────────────────────────────────

function InstrumentsPage() {
  const { user, account, instruments, balances, totalCount, page, pageSize } = Route.useLoaderData()
  const { accountId } = Route.useParams()
  const router = useRouter()
  const navigate = Route.useNavigate()
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

  // Sort instruments with default first
  const sortedInstruments = [...instruments].sort((a, b) => {
    if (a.id === account.defaultInstrumentId) return -1
    if (b.id === account.defaultInstrumentId) return 1
    return 0
  })

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
            {totalCount} instrument{totalCount !== 1 ? 's' : ''}
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
        columns={[
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
              const balance = balances.find((b) => b.instrumentId === row.original.id)
              const unitCount = balance?.unitCount ?? BigInt(0)
              const neg = unitCount < 0
              return (
                <span
                  className={[
                    'font-medium tabular-nums',
                    neg ? 'text-red-600 dark:text-red-400' : 'text-gray-900 dark:text-gray-100',
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
        ] satisfies ColumnDef<typeof sortedInstruments[number]>[]}
        pagination={{ page, pageSize, totalCount }}
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
