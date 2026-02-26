import { createFileRoute, Link } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { eq, and, desc, isNull, sql } from 'drizzle-orm'
import { db } from '~/db'
import { users, accounts, events } from '~/db/schema'

// ─── Server functions ─────────────────────────────────────────────────────────

const getEventsData = createServerFn({ method: 'GET' })
  .inputValidator((data: unknown) => data as { accountId: string; page?: number })
  .handler(async ({ data }) => {
    const [user] = await db.select().from(users).limit(1)
    if (!user) return { user: null, account: null, events: [], totalCount: 0, page: 1, pageSize: 20 }

    const [account] = await db
      .select()
      .from(accounts)
      .where(and(eq(accounts.id, data.accountId), eq(accounts.userId, user.id)))

    if (!account) return { user, account: null, events: [], totalCount: 0, page: 1, pageSize: 20 }

    const page = data.page ?? 1
    const pageSize = 20
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
}

export const Route = createFileRoute('/accounts/$accountId/events/')({
  validateSearch: (search: Record<string, unknown>): EventsSearch => ({
    page: typeof search.page === 'number' ? search.page : 1,
  }),
  loaderDeps: ({ search }) => ({ page: search.page }),
  loader: ({ params, deps }) =>
    getEventsData({ data: { accountId: params.accountId, page: deps.page } }),
  component: EventsPage,
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

  const totalPages = Math.ceil(totalCount / pageSize)

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
      {accountEvents.length === 0 ? (
        <p className="text-gray-500 dark:text-gray-400 text-sm">No events yet.</p>
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
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {accountEvents.map((event: any) => {
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
    </div>
  )
}
