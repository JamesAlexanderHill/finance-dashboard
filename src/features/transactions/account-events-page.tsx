import { createServerFn } from '@tanstack/react-start'
import { Link, useNavigate, useParams } from '@tanstack/react-router'
import { accountService, eventService, getSession } from '~/db/services'
import EventTable from '~/features/transactions/components/event/event-table'

const DEFAULT_PAGE_SIZE = 10

// ─── Server functions ─────────────────────────────────────────────────────────

const getData = createServerFn({ method: 'GET' })
  .inputValidator((data: unknown) => data as { accountId: string; page?: number; pageSize?: number })
  .handler(async ({ data }) => {
    const session = await getSession()
    if (!session) return { user: null, account: null, events: null }

    const ctx = session.ctx
    const account = await accountService.getById(ctx, data.accountId)

    if (!account) return { user: session.user, account: null, events: null }

    const page = data.page ?? 1
    const pageSize = data.pageSize ?? DEFAULT_PAGE_SIZE
    const offset = (page - 1) * pageSize

    const events = await eventService.listByAccount(ctx, data.accountId, { limit: pageSize, offset })

    return { user: session.user, account, events }
  })

export const accountEventsLoader = getData

export type AccountEventsPageData = Awaited<ReturnType<typeof getData>>

// ─── Component ────────────────────────────────────────────────────────────────

export function AccountEventsPage(props: AccountEventsPageData) {
  const { user, account, events } = props
  const { accountId } = useParams({ strict: false }) as { accountId: string }
  const navigate = useNavigate()

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

  if (!account || !events) {
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
        onRowClick={(event) => navigate({ search: (prev) => ({ ...(prev as object), viewEvent: event.id }) })}
        hideColumns={['account']}
      />
    </div>
  )
}
