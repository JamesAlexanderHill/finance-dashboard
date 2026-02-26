import * as React from 'react'
import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { eq, and, desc, sql } from 'drizzle-orm'
import { db } from '~/db'
import { users, accounts, files, events } from '~/db/schema'
import { formatCurrency } from '~/lib/format-currency'

// ─── Server functions ─────────────────────────────────────────────────────────

const getImportDetailData = createServerFn({ method: 'GET' })
  .inputValidator((data: unknown) => data as { accountId: string; importId: string; page?: number })
  .handler(async ({ data }) => {
    const [user] = await db.select().from(users).limit(1)
    if (!user) return { user: null, account: null, importRun: null, events: [], totalCount: 0, page: 1, pageSize: 20 }

    const [account] = await db
      .select()
      .from(accounts)
      .where(and(eq(accounts.id, data.accountId), eq(accounts.userId, user.id)))

    if (!account) return { user, account: null, importRun: null, events: [], totalCount: 0, page: 1, pageSize: 20 }

    const [importRun] = await db
      .select()
      .from(files)
      .where(and(eq(files.id, data.importId), eq(files.accountId, data.accountId)))

    if (!importRun) return { user, account, importRun: null, events: [], totalCount: 0, page: 1, pageSize: 20 }

    const page = data.page ?? 1
    const pageSize = 20
    const offset = (page - 1) * pageSize

    const [importEvents, countResult] = await Promise.all([
      db.query.events.findMany({
        where: eq(events.importRunId, data.importId),
        orderBy: [desc(events.effectiveAt)],
        limit: pageSize,
        offset,
        with: {
          legs: { with: { instrument: true } },
        },
      }),
      db
        .select({ count: sql<number>`count(*)` })
        .from(events)
        .where(eq(events.importRunId, data.importId)),
    ])

    return {
      user,
      account,
      importRun,
      events: importEvents,
      totalCount: Number(countResult[0]?.count ?? 0),
      page,
      pageSize,
    }
  })

const deleteImport = createServerFn({ method: 'POST' })
  .inputValidator((data: unknown) => data as { importId: string })
  .handler(async ({ data }) => {
    const [user] = await db.select().from(users).limit(1)
    if (!user) throw new Error('No user found')

    const [importRun] = await db
      .select()
      .from(files)
      .where(and(eq(files.id, data.importId), eq(files.userId, user.id)))

    if (!importRun) throw new Error('Import not found')

    const now = new Date()

    // Soft-delete the import and cascade to all events
    await db.transaction(async (tx) => {
      await tx
        .update(events)
        .set({ deletedAt: now })
        .where(eq(events.importRunId, data.importId))

      await tx
        .update(files)
        .set({ deletedAt: now })
        .where(eq(files.id, data.importId))
    })
  })

// ─── Route ────────────────────────────────────────────────────────────────────

interface ImportSearch {
  page?: number
}

export const Route = createFileRoute('/accounts/$accountId/imports/$importId')({
  validateSearch: (search: Record<string, unknown>): ImportSearch => ({
    page: typeof search.page === 'number' ? search.page : 1,
  }),
  loaderDeps: ({ search }) => ({ page: search.page }),
  loader: ({ params, deps }) =>
    getImportDetailData({ data: { accountId: params.accountId, importId: params.importId, page: deps.page } }),
  component: ImportDetailPage,
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

function formatDateTime(d: Date | string) {
  return new Date(d).toLocaleDateString('en-AU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatDate(d: Date | string) {
  return new Date(d).toLocaleDateString('en-AU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

// ─── Component ────────────────────────────────────────────────────────────────

function ImportDetailPage() {
  const { user, account, importRun, events: importEvents, totalCount, page, pageSize } = Route.useLoaderData()
  const { accountId, importId } = Route.useParams()
  const router = useRouter()
  const navigate = Route.useNavigate()
  const [deleting, setDeleting] = React.useState(false)

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

  if (!importRun) {
    return (
      <div className="text-gray-500 dark:text-gray-400 text-sm">
        Import not found.{' '}
        <Link
          to="/accounts/$accountId/imports"
          params={{ accountId }}
          className="text-blue-600 dark:text-blue-400 underline"
        >
          Back to imports
        </Link>
      </div>
    )
  }

  async function handleDelete() {
    if (!confirm('Delete this import? All events from this import will be removed.')) {
      return
    }
    setDeleting(true)
    try {
      await deleteImport({ data: { importId } })
      router.navigate({ to: '/accounts/$accountId/imports', params: { accountId } })
    } catch (err) {
      setDeleting(false)
      alert(`Delete failed: ${String(err)}`)
    }
  }

  const totalPages = Math.ceil(totalCount / pageSize)

  const stats = [
    { label: 'Imported', value: importRun.importedCount, color: 'text-green-700 dark:text-green-400' },
    { label: 'Skipped', value: importRun.skippedCount, color: 'text-gray-600 dark:text-gray-400' },
    { label: 'Restored', value: importRun.restoredCount, color: 'text-blue-700 dark:text-blue-400' },
    {
      label: 'Errors',
      value: importRun.errorCount,
      color: importRun.errorCount > 0 ? 'text-red-600 dark:text-red-400' : 'text-gray-400 dark:text-gray-500',
    },
  ]

  return (
    <div className="max-w-5xl space-y-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
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
          to="/accounts/$accountId/imports"
          params={{ accountId }}
          className="hover:text-blue-600 dark:hover:text-blue-400"
        >
          Imports
        </Link>
        <span>/</span>
        <span className="text-gray-900 dark:text-gray-100 truncate max-w-[200px]">{importRun.filename}</span>
      </div>

      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">{importRun.filename}</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Imported {formatDateTime(importRun.createdAt)}
          </p>
        </div>
        <button
          onClick={handleDelete}
          disabled={deleting}
          className="px-3 py-1.5 text-sm text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 border border-red-200 dark:border-red-800 rounded-md disabled:opacity-50"
        >
          {deleting ? 'Deleting...' : 'Delete'}
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-3">
        {stats.map((s) => (
          <div
            key={s.label}
            className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4 text-center"
          >
            <p className={`text-2xl font-bold tabular-nums ${s.color}`}>{s.value}</p>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Errors */}
      {importRun.errors.length > 0 && (
        <div className="rounded-lg bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 p-4">
          <p className="text-sm font-semibold text-red-700 dark:text-red-300 mb-2">
            Errors ({importRun.errors.length})
          </p>
          <ul className="space-y-1">
            {importRun.errors.map((err: { phase: string; line: number; message: string }, i: number) => (
              <li key={i} className="text-xs text-red-600 dark:text-red-400">
                [{err.phase}] Line {err.line}: {err.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Events */}
      <section>
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
          Associated Events ({totalCount})
        </h2>

        {importEvents.length === 0 ? (
          <p className="text-gray-500 dark:text-gray-400 text-sm">No events in this import.</p>
        ) : (
          <>
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
                    <th className="text-left px-4 py-3 font-medium text-gray-500 dark:text-gray-400">
                      Legs
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                  {importEvents.map((event: any) => {
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
                            to="/accounts/$accountId/events/$eventId"
                            params={{ accountId, eventId: event.id }}
                            className="text-gray-900 dark:text-gray-100 hover:text-blue-600 dark:hover:text-blue-400 font-medium"
                          >
                            {event.description}
                          </Link>
                        </td>
                        <td className="px-4 py-3">
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${badgeClass}`}>
                            {event.eventType}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap gap-1.5">
                            {event.legs.map((leg: any) => {
                              const neg = leg.unitCount < BigInt(0)
                              const abs = neg ? -leg.unitCount : leg.unitCount
                              return (
                                <span
                                  key={leg.id}
                                  className={[
                                    'text-xs tabular-nums px-1.5 py-0.5 rounded',
                                    neg
                                      ? 'bg-red-100 dark:bg-red-950 text-red-700 dark:text-red-300'
                                      : 'bg-green-100 dark:bg-green-950 text-green-700 dark:text-green-300',
                                  ].join(' ')}
                                >
                                  {formatCurrency(leg.unitCount, {
                                    exponent: leg.instrument.exponent,
                                    ticker: leg.instrument.ticker,
                                  })}
                                </span>
                              )
                            })}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between mt-4">
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  Page {page} of {totalPages}
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() => navigate({ search: { page: page - 1 } })}
                    disabled={page <= 1}
                    className="px-3 py-1.5 text-sm border border-gray-200 dark:border-gray-700 rounded-md disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50 dark:hover:bg-gray-800"
                  >
                    Previous
                  </button>
                  <button
                    onClick={() => navigate({ search: { page: page + 1 } })}
                    disabled={page >= totalPages}
                    className="px-3 py-1.5 text-sm border border-gray-200 dark:border-gray-700 rounded-md disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50 dark:hover:bg-gray-800"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  )
}
