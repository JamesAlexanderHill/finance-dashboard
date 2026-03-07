import { createFileRoute, Link } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { eq, and } from 'drizzle-orm'
import { db } from '~/db'
import { users, accounts } from '~/db/schema'
import { eventService, createContext } from '~/db/services'
import EventTable from '~/components/event/event-table'

// ─── Server functions ─────────────────────────────────────────────────────────

const DEFAULT_PAGE_SIZE = 10

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

    const ctx = createContext(user.id)
    const events = await eventService.list(ctx, {
      accountId: data.accountId,
      limit: pageSize,
      offset,
    })

    return {
      user,
      account,
      events,
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

// ─── Component ────────────────────────────────────────────────────────────────

function EventsPage() {
  const { user, account, events } = Route.useLoaderData()
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
        <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">{account.name} Events</h1>
        <span className="text-sm text-gray-500 dark:text-gray-400">
          {events.pagination.total} event{events.pagination.total !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Table */}
      <EventTable
        events={events.data}
        pagination={events.pagination}
        onPaginationChange={(p) => navigate({ search: p })}
        onRowClick={(event) => navigate({ search: (prev) => ({ ...prev, viewEvent: event.id }) })}
        hideColumns={['account']}
      />
    </div>
  )
}
