import * as React from 'react'
import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { eq, and, desc, isNull } from 'drizzle-orm'
import { db } from '~/db'
import { users, accounts, instruments, events, files } from '~/db/schema'
import { getUserBalances } from '~/lib/balance'
import { ImportWizard } from '~/components/ImportWizard'
import InstrumentCard from '~/components/instrument-card'
import PaginatedTable, { type ColumnDef } from '~/components/ui/table'
import EventPreviewTable from '~/components/event/event-preview-table'
import { getEvents, getFiles, getInstruments } from '~/db/queries'

// ─── Server functions ─────────────────────────────────────────────────────────

const getData = createServerFn({ method: 'GET' })
  .inputValidator((data: unknown) => data as { accountId: string })
  .handler(async ({ data }) => {
    const [user] = await db.select().from(users).limit(1)
    if (!user) return { user: null, account: null, instruments: [], balances: [], files: [], recentEvents: [] }

    const [account] = await db
      .select()
      .from(accounts)
      .where(and(eq(accounts.id, data.accountId), eq(accounts.userId, user.id)))

    if (!account) return { user, account: null, instruments: [], balances: [], files: [], recentEvents: [], legs: [] }

    const [allBalances, accountInstruments, recentAccountfiles, recentAccountEvents] = await Promise.all([
      getUserBalances(user.id),
      getInstruments(user.id, { accountIds: [data.accountId] }),
      getFiles(user.id, { accountId: data.accountId, limit: 5 }),
      getEvents(user.id, { accountId: data.accountId, limit: 10 }),
    ]);
    
    // Filter balances to only this account
    const balances = allBalances.filter((b) => b.accountId === data.accountId)

    return { user, account, accountInstruments, recentAccountfiles, recentAccountEvents, balances }
  })

const updateAccount = createServerFn({ method: 'POST' })
  .inputValidator((data: unknown) => data as { id: string; name: string; defaultInstrumentId: string | null })
  .handler(async ({ data }) => {
    const [user] = await db.select().from(users).limit(1)
    if (!user) throw new Error('No user found')
    await db
      .update(accounts)
      .set({
        name: data.name.trim(),
        defaultInstrumentId: data.defaultInstrumentId || null,
      })
      .where(and(eq(accounts.id, data.id), eq(accounts.userId, user.id)))
  })

// ─── Route ────────────────────────────────────────────────────────────────────

export const Route = createFileRoute('/accounts/$accountId/')({
  loader: ({ params }) => getData({ data: { accountId: params.accountId } }),
  component: AccountDetailPage,
})

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(d: Date | string) {
  return new Date(d).toLocaleDateString('en-AU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

function formatDateTime(d: Date | string) {
  return new Date(d).toLocaleDateString('en-AU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

// ─── Component ────────────────────────────────────────────────────────────────

function AccountDetailPage() {
  const { user, account, balances, accountInstruments, recentAccountfiles, recentAccountEvents } = Route.useLoaderData()
  const { accountId } = Route.useParams()
  const router = useRouter()
  const [editing, setEditing] = React.useState(false)
  const [showImportWizard, setShowImportWizard] = React.useState(false)
  const navigate = Route.useNavigate()

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

  async function handleUpdate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    await updateAccount({
      data: {
        id: account!.id,
        name: String(fd.get('name')),
        fileKey: String(fd.get('fileKey')),
        defaultInstrumentId: String(fd.get('defaultInstrumentId')) || null,
      },
    })
    setEditing(false)
    router.invalidate()
  }

  // Sort instruments: default first, then by balance (descending)
  const balanceMap = new Map(balances.map((b) => [b.instrumentId, b.unitCount]))
  const sortedInstruments = [...accountInstruments].sort((a, b) => {
    // Default instrument first
    if (a.id === account.defaultInstrumentId) return -1
    if (b.id === account.defaultInstrumentId) return 1
    // Then by balance (higher first)
    const balA = balanceMap.get(a.id) ?? BigInt(0)
    const balB = balanceMap.get(b.id) ?? BigInt(0)
    if (balB > balA) return 1
    if (balB < balA) return -1
    return 0
  })

  const defaultInstrument = accountInstruments.find((i) => i.id === account.defaultInstrumentId)

  const filesColumns: ColumnDef<typeof recentAccountfiles[number]>[] = [
    {
      id: 'date',
      header: 'Date',
      accessorKey: 'createdAt',
      cell: ({ getValue }) => (
        <span className="text-gray-500 dark:text-gray-400 whitespace-nowrap">
          {formatDateTime(getValue() as Date)}
        </span>
      ),
    },
    {
      id: 'filename',
      header: 'Filename',
      accessorKey: 'filename',
      cell: ({ row }) => (
        <span className="text-gray-900 dark:text-gray-100 font-medium">
          {row.original.filename}
        </span>
      ),
    },
    {
      id: 'stats',
      header: 'Results',
      cell: ({ row }) => (
        <div className="flex items-center gap-3 text-xs">
          <span className="text-green-700 dark:text-green-400 tabular-nums">
            {row.original.importedCount} imported
          </span>
          <span className="text-gray-400 dark:text-gray-500 tabular-nums">
            {row.original.skippedCount} skipped
          </span>
          {row.original.errorCount > 0 && (
            <span className="text-red-600 dark:text-red-400 tabular-nums">
              {row.original.errorCount} errors
            </span>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="max-w-5xl space-y-8">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
        <Link to="/accounts" className="hover:text-blue-600 dark:hover:text-blue-400">
          Accounts
        </Link>
        <span>/</span>
        <span className="text-gray-900 dark:text-gray-100">{account.name}</span>
      </div>

      {/* Section A: Account Details */}
      <section className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-6">
        {editing ? (
          <form onSubmit={handleUpdate} className="space-y-4 max-w-md">
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                Name
              </label>
              <input
                name="name"
                defaultValue={account.name}
                required
                className="w-full px-3 py-1.5 text-sm border border-gray-200 dark:border-gray-700 rounded-md bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                Default Instrument
              </label>
              <select
                name="defaultInstrumentId"
                defaultValue={account.defaultInstrumentId ?? ''}
                className="w-full px-3 py-1.5 text-sm border border-gray-200 dark:border-gray-700 rounded-md bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">None</option>
                {accountInstruments.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.ticker} - {i.name}
                  </option>
                ))}
              </select>
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
              <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">{account.name}</h1>
              <div className="flex items-center gap-4 mt-2 text-sm text-gray-500 dark:text-gray-400">
                <span>
                  Default:{' '}
                  {defaultInstrument ? (
                    <span className="text-blue-600 dark:text-blue-400">{defaultInstrument.ticker}</span>
                  ) : (
                    <span className="text-gray-400 dark:text-gray-500">None</span>
                  )}
                </span>
              </div>
            </div>
            <button
              onClick={() => setEditing(true)}
              className="px-3 py-1.5 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 border border-gray-200 dark:border-gray-700 rounded-md"
            >
              Edit
            </button>
          </div>
        )}
      </section>

      {/* Section B: Instruments Carousel */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Instruments</h2>
          <Link
            to="/accounts/$accountId/instruments"
            params={{ accountId: account.id }}
            className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
          >
            View all
          </Link>
        </div>

        {sortedInstruments.length === 0 ? (
          <p className="text-gray-500 dark:text-gray-400 text-sm">No instruments yet.</p>
        ) : (
          <div className="flex gap-4 overflow-x-auto pb-2 -mx-2 px-2">
            {sortedInstruments.map((instrument) => {
              const balance = balances.find((b) => b.instrumentId === instrument.id)
              const amountMinor = balance?.unitCount ?? BigInt(0)
              const neg = amountMinor < 0
              const abs = neg ? -amountMinor : amountMinor
              const isDefault = instrument.id === account.defaultInstrumentId

              return (
                <InstrumentCard
                  key={instrument.id}
                  instrument={instrument}
                  account={account}
                  unitCount={amountMinor}
                  isDefault={isDefault}
                />
              )
            })}
          </div>
        )}
      </section>

      {/* Section C: Recent Files */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Recent Files</h2>
          <div className="flex items-center gap-3">
            <Link
              to="/accounts/$accountId/files"
              params={{ accountId: account.id }}
              className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
            >
              View all
            </Link>
            {!showImportWizard && (
              <button
                onClick={() => setShowImportWizard(true)}
                className="px-3 py-1.5 text-sm font-medium bg-blue-600 hover:bg-blue-700 text-white rounded-md transition-colors"
              >
                + Import CSV
              </button>
            )}
          </div>
        </div>

        {showImportWizard && (
          <div className="mb-6">
            <ImportWizard
              userId={user!.id}
              accountId={account!.id}
              accountName={account!.name}
              onClose={() => setShowImportWizard(false)}
              onSuccess={() => {
                setShowImportWizard(false)
                router.invalidate()
              }}
            />
          </div>
        )}

        <PaginatedTable
          data={recentAccountfiles}
          columns={filesColumns}
          pagination={{ page: 1, pageSize: 5, totalCount: recentAccountfiles.length }}
          onPaginationChange={() => {}}
          hidePagination
          onRowClick={(row) =>
            navigate({
              to: '/accounts/$accountId/files/$fileId',
              params: { accountId: account.id, fileId: row.id },
            })
          }
          getRowId={(row) => row.id}
        >
          <p>No files yet.</p>
        </PaginatedTable>
      </section>

      {/* Section D: Recent Events */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Recent Events</h2>
          <Link
            to="/accounts/$accountId/events"
            params={{ accountId }}
            className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
          >
            View all
          </Link>
        </div>

        <EventPreviewTable
          hideColumns={["account"]} // hide account filter since we are already scoped to an account
          events={recentAccountEvents}
        />
      </section>
    </div>
  )
}
