import * as React from 'react'
import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { eq, and, desc, sql } from 'drizzle-orm'
import { db } from '~/db'
import { users, accounts, files, events } from '~/db/schema'
import { formatCurrency } from '~/lib/format-currency'
import PaginatedTable, { type ColumnDef } from '~/components/paginated-table'

// ─── Server functions ─────────────────────────────────────────────────────────

const getFilesDetailData = createServerFn({ method: 'GET' })
  .inputValidator((data: unknown) => data as { accountId: string; fileId: string; page?: number; pageSize?: number })
  .handler(async ({ data }) => {
    const [user] = await db.select().from(users).limit(1)
    if (!user) return { user: null, account: null, file: null, events: [], totalCount: 0, page: 1, pageSize: 20 }

    const [account] = await db
      .select()
      .from(accounts)
      .where(and(eq(accounts.id, data.accountId), eq(accounts.userId, user.id)))

    if (!account) return { user, account: null, file: null, events: [], totalCount: 0, page: 1, pageSize: 20 }

    const [file] = await db
      .select()
      .from(files)
      .where(and(eq(files.id, data.fileId), eq(files.accountId, data.accountId)))

    if (!file) return { user, account, file: null, events: [], totalCount: 0, page: 1, pageSize: 20 }

    const page = data.page ?? 1
    const pageSize = data.pageSize ?? 20
    const offset = (page - 1) * pageSize

    const [fileEvents, countResult] = await Promise.all([
      db.query.events.findMany({
        where: eq(events.fileId, data.fileId),
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
        .where(eq(events.fileId, data.fileId)),
    ])

    return {
      user,
      account,
      file,
      events: fileEvents,
      totalCount: Number(countResult[0]?.count ?? 0),
      page,
      pageSize,
    }
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
  })

// ─── Route ────────────────────────────────────────────────────────────────────

const DEFAULT_PAGE_SIZE = 20

interface ImportSearch {
  page?: number
  pageSize?: number
}

export const Route = createFileRoute('/accounts/$accountId/files/$fileId')({
  validateSearch: (search: Record<string, unknown>): ImportSearch => ({
    page: typeof search.page === 'number' ? search.page : 1,
    pageSize: typeof search.pageSize === 'number' ? search.pageSize : DEFAULT_PAGE_SIZE,
  }),
  loaderDeps: ({ search }) => ({ page: search.page, pageSize: search.pageSize }),
  loader: ({ params, deps }) =>
    getFilesDetailData({ data: { accountId: params.accountId, fileId: params.fileId, page: deps.page, pageSize: deps.pageSize } }),
  component: FileDetailPage,
})

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

function FileDetailPage() {
  const { user, account, file, events: fileEvents, totalCount, page, pageSize } = Route.useLoaderData()
  const { accountId, fileId } = Route.useParams()
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

  if (!file) {
    return (
      <div className="text-gray-500 dark:text-gray-400 text-sm">
        File not found.{' '}
        <Link
          to="/accounts/$accountId/files"
          params={{ accountId }}
          className="text-blue-600 dark:text-blue-400 underline"
        >
          Back to imports
        </Link>
      </div>
    )
  }

  async function handleDelete() {
    if (!confirm('Delete this file? All events from this file will be removed.')) {
      return
    }
    setDeleting(true)
    try {
      await deleteFile({ data: { fileId } })
      router.navigate({ to: '/accounts/$accountId/files', params: { accountId } })
    } catch (err) {
      setDeleting(false)
      alert(`Delete failed: ${String(err)}`)
    }
  }

  const stats = [
    { label: 'Imported', value: file.importedCount, color: 'text-green-700 dark:text-green-400' },
    { label: 'Skipped', value: file.skippedCount, color: 'text-gray-600 dark:text-gray-400' },
    { label: 'Restored', value: file.restoredCount, color: 'text-blue-700 dark:text-blue-400' },
    {
      label: 'Errors',
      value: file.errorCount,
      color: file.errorCount > 0 ? 'text-red-600 dark:text-red-400' : 'text-gray-400 dark:text-gray-500',
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
          to="/accounts/$accountId/files"
          params={{ accountId }}
          className="hover:text-blue-600 dark:hover:text-blue-400"
        >
          Files
        </Link>
        <span>/</span>
        <span className="text-gray-900 dark:text-gray-100 truncate max-w-[200px]">{file.filename}</span>
      </div>

      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">{file.filename}</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Imported {formatDateTime(file.createdAt)}
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
      {file.errors.length > 0 && (
        <div className="rounded-lg bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 p-4">
          <p className="text-sm font-semibold text-red-700 dark:text-red-300 mb-2">
            Errors ({file.errors.length})
          </p>
          <ul className="space-y-1">
            {file.errors.map((err: { phase: string; line: number; message: string }, i: number) => (
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

        <PaginatedTable
          data={fileEvents}
          columns={[
            {
              id: 'date',
              header: 'Date',
              accessorKey: 'effectiveAt',
              cell: ({ getValue }) => (
                <span className="text-gray-500 dark:text-gray-400 whitespace-nowrap">
                  {formatDate(getValue() as Date)}
                </span>
              ),
            },
            {
              id: 'description',
              header: 'Description',
              accessorKey: 'description',
              cell: ({ row }) => (
                <span className="text-gray-900 dark:text-gray-100 font-medium">
                  {row.original.description}
                </span>
              ),
            },
            {
              id: 'legs',
              header: 'Legs',
              cell: ({ row }) => (
                <div className="flex flex-wrap gap-1.5">
                  {row.original.legs.map((leg: any) => {
                    const neg = leg.unitCount < BigInt(0)
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
              ),
            },
          ] satisfies ColumnDef<typeof fileEvents[number]>[]}
          pagination={{ page, pageSize, totalCount }}
          onPaginationChange={(p) => navigate({ search: p })}
          onRowClick={(event) =>
            navigate({ search: (prev) => ({ ...prev, viewEvent: event.id }) })
          }
          getRowId={(row) => row.id}
        >
          <p>No events in this import.</p>
        </PaginatedTable>
      </section>
    </div>
  )
}
