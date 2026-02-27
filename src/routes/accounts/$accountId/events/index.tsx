import { createFileRoute, Link } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { eq, and, desc, isNull, sql } from 'drizzle-orm'
import { db } from '~/db'
import { users, accounts, events } from '~/db/schema'
import PaginatedTable, { type ColumnDef } from '~/components/paginated-table'

// ─── Server functions ─────────────────────────────────────────────────────────

const DEFAULT_PAGE_SIZE = 20

const getEventsData = createServerFn({ method: 'GET' })
  .inputValidator((data: unknown) => data as { accountId: string; page?: number; pageSize?: number })
  .handler(async ({ data }) => {
    const [user] = await db.select().from(users).limit(1)
    if (!user) return { user: null, account: null, events: [], totalCount: 0, page: 1, pageSize: DEFAULT_PAGE_SIZE }

    const [account] = await db
      .select()
      .from(accounts)
      .where(and(eq(accounts.id, data.accountId), eq(accounts.userId, user.id)))

    if (!account) return { user, account: null, events: [], totalCount: 0, page: 1, pageSize: DEFAULT_PAGE_SIZE }

    const page = data.page ?? 1
    const pageSize = data.pageSize ?? DEFAULT_PAGE_SIZE
    const offset = (page - 1) * pageSize

    const [accountEvents, countResult] = await Promise.all([
      db.query.events.findMany({
        where: and(eq(events.accountId, data.accountId), isNull(events.deletedAt)),
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
        .where(and(eq(events.accountId, data.accountId), isNull(events.deletedAt))),
    ])

    return {
      user,
      account,
      events: accountEvents,
      totalCount: Number(countResult[0]?.count ?? 0),
      page,
      pageSize,
    }
  })

// ─── Route ────────────────────────────────────────────────────────────────────

interface EventsSearch {
  page?: number
  pageSize?: number
}

export const Route = createFileRoute('/accounts/$accountId/events/')({
  validateSearch: (search: Record<string, unknown>): EventsSearch => ({
    page: typeof search.page === 'number' ? search.page : 1,
    pageSize: typeof search.pageSize === 'number' ? search.pageSize : DEFAULT_PAGE_SIZE,
  }),
  loaderDeps: ({ search }) => ({ page: search.page, pageSize: search.pageSize }),
  loader: ({ params, deps }) =>
    getEventsData({ data: { accountId: params.accountId, page: deps.page, pageSize: deps.pageSize } }),
  component: EventsPage,
})

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(d: Date | string) {
  return new Date(d).toLocaleDateString('en-AU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

// ─── Component ────────────────────────────────────────────────────────────────

function EventsPage() {
  const { user, account, events: accountEvents, totalCount, page, pageSize } = Route.useLoaderData()
  const { accountId } = Route.useParams()
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

  // Define columns for the table
  const columns: ColumnDef<typeof accountEvents[number]>[] = [
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
  ]

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
        <span className="text-gray-900 dark:text-gray-100">Events</span>
      </div>

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">Events</h1>
        <span className="text-sm text-gray-500 dark:text-gray-400">
          {totalCount} event{totalCount !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Table */}
      <PaginatedTable
        data={accountEvents}
        columns={columns}
        pagination={{ page, pageSize, totalCount }}
        onPaginationChange={(p) => navigate({ search: p })}
        onRowClick={(event) => navigate({ search: (prev) => ({ ...prev, viewEvent: event.id }) })}
        getRowId={(row) => row.id}
        showColumnVisibilityToggle
      >
        <p>No events yet.</p>
      </PaginatedTable>
    </div>
  )
}
