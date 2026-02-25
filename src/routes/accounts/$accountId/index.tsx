import * as React from 'react'
import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { eq, and, desc, isNull } from 'drizzle-orm'
import { db } from '~/db'
import { users, accounts, instruments, events, importRuns } from '~/db/schema'
import { getUserBalances, formatAmount } from '~/lib/balance'
import { ImportWizard } from '~/components/ImportWizard'

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
        .from(importRuns)
        .where(and(eq(importRuns.accountId, data.accountId), isNull(importRuns.deletedAt)))
        .orderBy(desc(importRuns.createdAt))
        .limit(20),
      db.query.events.findMany({
        where: and(
          eq(events.accountId, data.accountId),
          isNull(events.deletedAt),
        ),
        orderBy: [desc(events.effectiveAt)],
        limit: 10,
      }),
    ])

    // Filter balances to only this account
    const balances = allBalances.filter((b) => b.accountId === data.accountId)

    return { user, account, instruments: accountInstruments, balances, importRuns: accountImportRuns, recentEvents }
  })

const updateAccount = createServerFn({ method: 'POST' })
  .inputValidator((data: unknown) => data as { id: string; name: string; importerKey: string })
  .handler(async ({ data }) => {
    const [user] = await db.select().from(users).limit(1)
    if (!user) throw new Error('No user found')
    await db
      .update(accounts)
      .set({ name: data.name.trim(), importerKey: data.importerKey.trim() })
      .where(and(eq(accounts.id, data.id), eq(accounts.userId, user.id)))
  })

const deleteImportRun = createServerFn({ method: 'POST' })
  .inputValidator((data: unknown) => data as { importRunId: string })
  .handler(async ({ data }) => {
    const [user] = await db.select().from(users).limit(1)
    if (!user) throw new Error('No user found')

    // Verify the import run belongs to the user
    const [run] = await db
      .select()
      .from(importRuns)
      .where(and(eq(importRuns.id, data.importRunId), eq(importRuns.userId, user.id)))

    if (!run) throw new Error('Import run not found')

    const now = new Date()

    // Soft-delete the import run and cascade to all events
    await db.transaction(async (tx) => {
      // Soft-delete all events from this import run
      await tx
        .update(events)
        .set({ deletedAt: now })
        .where(eq(events.importRunId, data.importRunId))

      // Soft-delete the import run itself
      await tx
        .update(importRuns)
        .set({ deletedAt: now })
        .where(eq(importRuns.id, data.importRunId))
    })
  })

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

// ─── Component ────────────────────────────────────────────────────────────────

function AccountDetailPage() {
  const { user, account, instruments, balances, importRuns, recentEvents } = Route.useLoaderData()
  const router = useRouter()
  const [editing, setEditing] = React.useState(false)
  const [deletingImportId, setDeletingImportId] = React.useState<string | null>(null)
  const [showImportWizard, setShowImportWizard] = React.useState(false)

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
      },
    })
    setEditing(false)
    router.invalidate()
  }

  async function handleDeleteImport(importRunId: string) {
    if (!confirm('Delete this import? All events from this import will be removed.')) {
      return
    }
    setDeletingImportId(importRunId)
    try {
      await deleteImportRun({ data: { importRunId } })
      router.invalidate()
    } finally {
      setDeletingImportId(null)
    }
  }

  // Map instruments by ID for quick lookup
  const instrumentsById = new Map(instruments.map((i) => [i.id, i]))

  return (
    <div className="max-w-5xl space-y-8">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400 mb-2">
          <Link to="/accounts" className="hover:text-blue-600 dark:hover:text-blue-400">
            Accounts
          </Link>
          <span>/</span>
          <span className="text-gray-900 dark:text-gray-100">{account.name}</span>
        </div>

        {editing ? (
          <form onSubmit={handleUpdate} className="p-4 bg-gray-50 dark:bg-gray-800 rounded-lg space-y-3 max-w-md">
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
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                Importer: {account.importerKey}
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

      {/* Instruments */}
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

        {instruments.length === 0 ? (
          <p className="text-gray-500 dark:text-gray-400 text-sm">No instruments yet.</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {instruments.map((instrument) => {
              const balance = balances.find((b) => b.instrumentId === instrument.id)
              const amountMinor = balance?.amountMinor ?? BigInt(0)
              const neg = amountMinor < 0
              const abs = neg ? -amountMinor : amountMinor

              return (
                <Link
                  key={instrument.id}
                  to="/accounts/$accountId/instruments/$instrumentId"
                  params={{ accountId: account.id, instrumentId: instrument.id }}
                  className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4 hover:border-blue-300 dark:hover:border-blue-700 transition-colors"
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="font-medium text-gray-900 dark:text-gray-100">{instrument.code}</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">{instrument.name}</p>
                    </div>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400">
                      {instrument.kind}
                    </span>
                  </div>
                  <p
                    className={[
                      'mt-3 text-lg font-semibold tabular-nums',
                      neg ? 'text-red-600 dark:text-red-400' : 'text-gray-900 dark:text-gray-100',
                    ].join(' ')}
                  >
                    {neg ? '−' : ''}
                    {formatAmount(abs, instrument.minorUnit)}
                  </p>
                </Link>
              )
            })}
          </div>
        )}
      </section>

      {/* Import History */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Import History</h2>
          {!showImportWizard && (
            <button
              onClick={() => setShowImportWizard(true)}
              className="px-3 py-1.5 text-sm font-medium bg-blue-600 hover:bg-blue-700 text-white rounded-md transition-colors"
            >
              + Import CSV
            </button>
          )}
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
          <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50">
                  <th className="text-left px-4 py-3 font-medium text-gray-500 dark:text-gray-400">Date</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500 dark:text-gray-400">File</th>
                  <th className="text-right px-4 py-3 font-medium text-gray-500 dark:text-gray-400">Imported</th>
                  <th className="text-right px-4 py-3 font-medium text-gray-500 dark:text-gray-400">Skipped</th>
                  <th className="text-right px-4 py-3 font-medium text-gray-500 dark:text-gray-400">Errors</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {importRuns.map((run) => (
                  <tr key={run.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                    <td className="px-4 py-3 text-gray-500 dark:text-gray-400 whitespace-nowrap">
                      {formatDate(run.createdAt)}
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        key={run.id}
                        to="/accounts/$accountId/imports/$importId"
                        params={{ accountId: account.id, importId: run.id }}
                        className="text-blue-600 dark:text-blue-400 hover:underline"
                      >
                        {run.filename}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-right text-green-700 dark:text-green-400 tabular-nums">
                      {run.importedCount}
                    </td>
                    <td className="px-4 py-3 text-right text-gray-500 dark:text-gray-400 tabular-nums">
                      {run.skippedCount}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      <span
                        className={
                          run.errorCount > 0
                            ? 'text-red-600 dark:text-red-400'
                            : 'text-gray-400 dark:text-gray-500'
                        }
                      >
                        {run.errorCount}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => handleDeleteImport(run.id)}
                        disabled={deletingImportId === run.id}
                        className="text-xs text-gray-400 dark:text-gray-500 hover:text-red-600 dark:hover:text-red-400 disabled:opacity-50"
                        title="Delete import"
                      >
                        {deletingImportId === run.id ? 'Deleting...' : 'Delete'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Recent Events */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Recent Events</h2>
          <Link
            to="/events"
            search={{ accountId: account.id }}
            className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
          >
            View all
          </Link>
        </div>

        {recentEvents.length === 0 ? (
          <p className="text-gray-500 dark:text-gray-400 text-sm">No events yet.</p>
        ) : (
          <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50">
                  <th className="text-left px-4 py-3 font-medium text-gray-500 dark:text-gray-400 w-28">
                    Date
                  </th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500 dark:text-gray-400">
                    Description
                  </th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500 dark:text-gray-400 w-28">
                    Type
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {recentEvents.map((event) => {
                  const badgeClass = EVENT_TYPE_BADGE[event.eventType] ?? ''
                  return (
                    <tr
                      key={event.id}
                      className="hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
                    >
                      <td className="px-4 py-3 text-gray-500 dark:text-gray-400 whitespace-nowrap">
                        {formatDate(event.effectiveAt)}
                      </td>
                      <td className="px-4 py-3">
                        <Link
                          to="/events/$eventId"
                          params={{ eventId: event.id }}
                          className="text-gray-900 dark:text-gray-100 hover:text-blue-600 dark:hover:text-blue-400 font-medium"
                        >
                          {event.description}
                        </Link>
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`text-xs px-2 py-0.5 rounded-full font-medium ${badgeClass}`}
                        >
                          {event.eventType}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
