import { createFileRoute } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import EventTable from '~/components/event/event-table'
import { db } from '~/db'
import { eventService, accountService, createContext } from '~/db/services'
import { users } from '~/db/schema'

const DEFAULT_PAGE_SIZE = 10

// ─── Server functions ─────────────────────────────────────────────────────────

const getData = createServerFn({ method: 'GET' })
  .inputValidator((data: unknown) => data as { page?: number, pageSize?: number, accountId?: string })
  .handler(async ({ data }) => {
    const [user] = await db.select().from(users).limit(1)
    if (!user) return { user: null, events: [], accounts: [] }

    // paginated events
    const page = data.page ?? 1
    const pageSize = data.pageSize ?? DEFAULT_PAGE_SIZE
    const offset = (page - 1) * pageSize

    const ctx = createContext(user.id)

    // need the account list so that we can filter events by account id
    const [accountsResult, eventsResult] = await Promise.all([
      accountService.list(ctx, { limit: 200 }), // surely someone does not have more than 200 accounts
      eventService.list(ctx, { accountId: data.accountId, limit: pageSize, offset }),
    ]);

    return {
      user,
      events: eventsResult,
      accounts: accountsResult,
    }
  })

// ─── Route ────────────────────────────────────────────────────────────────────

interface EventsSearch {
  accountId?: string
  page?: number
  pageSize?: number
}

export const Route = createFileRoute('/events/')({
  validateSearch: (search: Record<string, unknown>): EventsSearch => ({
    accountId: typeof search.accountId === 'string' ? search.accountId : undefined,
    page: typeof search.page === 'number' ? search.page : 1,
    pageSize: typeof search.pageSize === 'number' ? search.pageSize : DEFAULT_PAGE_SIZE,
  }),
  loaderDeps: ({ search }) => ({ page: search.page, pageSize: search.pageSize, accountId: search.accountId }),
  loader: ({ deps }) =>
    getData({ data: { accountId: deps.accountId, page: deps.page, pageSize: deps.pageSize } }),
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
  const { user, accounts, events } = Route.useLoaderData()
  const { accountId } = Route.useSearch()
  const navigate = Route.useNavigate()

  if (!user) {
    return (
      <div className="text-gray-500 dark:text-gray-400 text-sm">
        No user found. Visit{' '}
        <a href="/dev" className="text-blue-600 dark:text-blue-400 underline">
          Dev Tools
        </a>
        .
      </div>
    )
  }

  const selectedAccount = accounts.data.find((a) => a.id === accountId)

  return (
    <div className="max-w-5xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">Events</h1>
          {selectedAccount && (
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
              Filtered by: {selectedAccount.name}
            </p>
          )}
        </div>

        {/* Account filter */}
        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-500 dark:text-gray-400">Account:</label>
          <select
            value={accountId ?? ''}
            onChange={(e) =>
              navigate({
                search: (prev) => ({ ...prev, accountId: e.target.value || undefined }),
              })
            }
            className="text-sm border border-gray-200 dark:border-gray-700 rounded-md px-2 py-1.5 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">All accounts</option>
            {accounts.data.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Recent Events */}
      <section>
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">Recent Events</h2>
        <EventTable
          events={events.data}
          pagination={events.pagination}
          onPaginationChange={(p) => navigate({ search: p })}
          onRowClick={(event) => navigate({ search: (prev) => ({ ...prev, viewEvent: event.id }) })}
        />
      </section>
    </div>
  )
}
