import { createServerFn } from '@tanstack/react-start'
import { useNavigate, useSearch } from '@tanstack/react-router'
import EventTable from '~/features/transactions/components/event/event-table'
import { eventService, accountService, getSession } from '~/db/services'

const DEFAULT_PAGE_SIZE = 10

// ─── Server functions ─────────────────────────────────────────────────────────

const getData = createServerFn({ method: 'GET' })
  .inputValidator((data: unknown) => data as { page?: number, pageSize?: number, accountId?: string })
  .handler(async ({ data }) => {
    const session = await getSession()
    if (!session) return { user: null, events: [], accounts: [] }

    const page = data.page ?? 1
    const pageSize = data.pageSize ?? DEFAULT_PAGE_SIZE
    const offset = (page - 1) * pageSize
    const ctx = session.ctx

    const [accountsResult, eventsResult] = await Promise.all([
      accountService.list(ctx, { limit: 200 }),
      eventService.listAll(ctx, { accountId: data.accountId, limit: pageSize, offset }),
    ])

    return {
      user: session.user,
      events: eventsResult,
      accounts: accountsResult,
    }
  })

export const eventsLoader = getData

export type EventsPageData = Awaited<ReturnType<typeof getData>>

// ─── Component ────────────────────────────────────────────────────────────────

export function EventsPage(props: EventsPageData) {
  const { user, accounts, events } = props
  const search = useSearch({ strict: false }) as { accountId?: string }
  const navigate = useNavigate()
  const accountId = search.accountId

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
                search: (prev) => ({ ...(prev as object), accountId: e.target.value || undefined }),
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
          onRowClick={(event) => navigate({ search: (prev) => ({ ...(prev as object), viewEvent: event.id }) })}
        />
      </section>
    </div>
  )
}
