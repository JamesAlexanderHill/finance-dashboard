import * as React from 'react'
import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { eq, and, desc, isNull } from 'drizzle-orm'
import { db } from '~/db'
import { users, accounts, instruments, events, files, Leg, Event } from '~/db/schema'
import { getUserBalances } from '~/lib/balance'
import { ImportWizard } from '~/components/ImportWizard'
import InstrumentCard from '~/components/instrument-card'
import { formatCurrency } from '~/lib/format-currency'

// ─── Server functions ─────────────────────────────────────────────────────────

const getAccountDetailData = createServerFn({ method: 'GET' })
  .inputValidator((data: unknown) => data as { accountId: string })
  .handler(async ({ data }) => {
    const [user] = await db.select().from(users).limit(1)
    if (!user) return { user: null, account: null, instruments: [], balances: [], importRuns: [], recentEvents: [] }

    const [account] = await db
      .select()
      .from(accounts)
      .where(and(eq(accounts.id, data.accountId), eq(accounts.userId, user.id)))

    if (!account) return { user, account: null, instruments: [], balances: [], importRuns: [], recentEvents: [] }

    const [accountInstruments, allBalances, accountImportRuns, recentEvents] = await Promise.all([
      db.select().from(instruments).where(eq(instruments.accountId, data.accountId)),
      getUserBalances(user.id),
      db
        .select()
        .from(files)
        .where(eq(files.accountId, data.accountId))
        .orderBy(desc(files.createdAt))
        .limit(5),
      db.query.events.findMany({
        where: and(
          eq(events.accountId, data.accountId),
          isNull(events.deletedAt),
        ),
        orderBy: [desc(events.effectiveAt)],
        limit: 10,
        with: {
          legs: { with: { instrument: true } },
        },
      }),
    ])

    // Filter balances to only this account
    const balances = allBalances.filter((b) => b.accountId === data.accountId)

    return { user, account, instruments: accountInstruments, balances, importRuns: accountImportRuns, recentEvents }
  })

const updateAccount = createServerFn({ method: 'POST' })
  .inputValidator((data: unknown) => data as { id: string; name: string; importerKey: string; defaultInstrumentId: string | null })
  .handler(async ({ data }) => {
    const [user] = await db.select().from(users).limit(1)
    if (!user) throw new Error('No user found')
    await db
      .update(accounts)
      .set({
        name: data.name.trim(),
        importerKey: data.importerKey.trim(),
        defaultInstrumentId: data.defaultInstrumentId || null,
      })
      .where(and(eq(accounts.id, data.id), eq(accounts.userId, user.id)))
  })

const deleteFile = createServerFn({ method: 'POST' })
  .inputValidator((data: unknown) => data as { fileId: string })
  .handler(async ({ data }) => {
    const [user] = await db.select().from(users).limit(1)
    if (!user) throw new Error('No user found')

    const [file] = await db
      .delete(files)
      .where(and(eq(files.id, data.fileId), eq(files.userId, user.id)))
      .returning();

    if (!file) throw new Error('File not found')
  });

// ─── Route ────────────────────────────────────────────────────────────────────

export const Route = createFileRoute('/accounts/$accountId/')({
  loader: ({ params }) => getAccountDetailData({ data: { accountId: params.accountId } }),
  component: AccountDetailPage,
})

// ─── Helpers ──────────────────────────────────────────────────────────────────

const EVENT_TYPE_BADGE: Record<string, string> = {
  purchase: 'bg-orange-100 dark:bg-orange-950 text-orange-700 dark:text-orange-300',
  transfer: 'bg-blue-100 dark:bg-blue-950 text-blue-700 dark:text-blue-300',
  exchange: 'bg-teal-100 dark:bg-teal-950 text-teal-700 dark:text-teal-300',
  trade: 'bg-purple-100 dark:bg-purple-950 text-purple-700 dark:text-purple-300',
  bill_payment: 'bg-red-100 dark:bg-red-950 text-red-700 dark:text-red-300',
  payout: 'bg-green-100 dark:bg-green-950 text-green-700 dark:text-green-300',
}

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
  const { user, account, instruments, balances, importRuns, recentEvents } = Route.useLoaderData()
  const { accountId } = Route.useParams()
  const router = useRouter()
  const [editing, setEditing] = React.useState(false)
  const [deletingImportId, setDeletingImportId] = React.useState<string | null>(null)
  const [showImportWizard, setShowImportWizard] = React.useState(false)
  const [expandedEventId, setExpandedEventId] = React.useState<string | null>(null)

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
        importerKey: String(fd.get('importerKey')),
        defaultInstrumentId: String(fd.get('defaultInstrumentId')) || null,
      },
    })
    setEditing(false)
    router.invalidate()
  }

  async function handleDeleteFile(fileId: string) {
    if (!confirm('Delete this import? All events from this import will be removed.')) {
      return
    }
    setDeletingImportId(fileId)
    try {
      await deleteFile({ data: { fileId } })
      router.invalidate()
    } finally {
      setDeletingImportId(null)
    }
  }

  // Sort instruments: default first, then by balance (descending)
  const balanceMap = new Map(balances.map((b) => [b.instrumentId, b.unitCount]))
  const sortedInstruments = [...instruments].sort((a, b) => {
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

  const defaultInstrument = instruments.find((i) => i.id === account.defaultInstrumentId)

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
                {instruments.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.ticker} - {i.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                Importer Key
              </label>
              <input
                name="importerKey"
                defaultValue={account.importerKey}
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
                <span>Importer: {account.importerKey}</span>
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

      {/* Section C: Recent Imports */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Recent Imports</h2>
          <div className="flex items-center gap-3">
            <Link
              to="/accounts/$accountId/imports"
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

        {importRuns.length === 0 ? (
          <p className="text-gray-500 dark:text-gray-400 text-sm">No imports yet.</p>
        ) : (
          <div className="space-y-2">
            {importRuns.map((run) => (
              <div
                key={run.id}
                className="flex items-center justify-between bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg px-4 py-3"
              >
                <div className="flex items-center gap-4">
                  <span className="text-xs text-gray-400 dark:text-gray-500 whitespace-nowrap">
                    {formatDateTime(run.createdAt)}
                  </span>
                  <Link
                    to="/accounts/$accountId/imports/$importId"
                    params={{ accountId: account.id, importId: run.id }}
                    className="text-sm text-blue-600 dark:text-blue-400 hover:underline font-medium"
                  >
                    {run.filename}
                  </Link>
                </div>
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-3 text-xs">
                    <span className="text-green-700 dark:text-green-400 tabular-nums">{run.importedCount} imported</span>
                    <span className="text-gray-400 dark:text-gray-500 tabular-nums">{run.skippedCount} skipped</span>
                    {run.errorCount > 0 && (
                      <span className="text-red-600 dark:text-red-400 tabular-nums">{run.errorCount} errors</span>
                    )}
                  </div>
                  <button
                    onClick={() => handleDeleteFile(run.id)}
                    disabled={deletingImportId === run.id}
                    className="text-xs text-gray-400 dark:text-gray-500 hover:text-red-600 dark:hover:text-red-400 disabled:opacity-50"
                    title="Delete import"
                  >
                    {deletingImportId === run.id ? '...' : 'Delete'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Section D: Recent Events (Accordion) */}
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

        {recentEvents.length === 0 ? (
          <p className="text-gray-500 dark:text-gray-400 text-sm">No events yet.</p>
        ) : (
          <div className="space-y-2">
            {recentEvents.map((event: Event) => {
              const isExpanded = expandedEventId === event.id;
              const badgeClass = '';

              return (
                <div
                  key={event.id}
                  className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg overflow-hidden"
                >
                  {/* Collapsed header */}
                  <button
                    onClick={() => setExpandedEventId(isExpanded ? null : event.id)}
                    className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
                  >
                    <div className="flex items-center gap-4 flex-1 min-w-0">
                      <span className="text-xs text-gray-400 dark:text-gray-500 whitespace-nowrap">
                        {formatDate(event.effectiveAt)}
                      </span>
                      <span className="text-sm text-gray-900 dark:text-gray-100 font-medium truncate">
                        {event.description}
                      </span>
                    </div>
                  </button>

                  {/* Expanded content */}
                  {isExpanded && (
                    <div className="px-4 pb-4 pt-2 border-t border-gray-100 dark:border-gray-800">
                      <div className="mt-3 pt-3 border-t border-gray-100 dark:border-gray-800">
                        <Link
                          to="/accounts/$accountId/events/$eventId"
                          params={{ accountId, eventId: event.id }}
                          className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
                        >
                          View event details
                        </Link>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </section>
    </div>
  )
}
