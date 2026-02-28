import { createFileRoute } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { eq, desc, and, inArray } from 'drizzle-orm'
import Badge from '~/components/atom/badge'
import PaginatedTable, { ColumnDef } from '~/components/paginated-table'
import { db } from '~/db'
import { getUserAccounts, getUserInstruments } from '~/db/queries'
import { users, events, legs } from '~/db/schema'
import scaleUnit from '~/lib/scale-unit'

// ─── Server functions ─────────────────────────────────────────────────────────

const getEventsData = createServerFn({ method: 'GET' })
  .inputValidator((data: unknown) => data as { accountId?: string })
  .handler(async ({ data }) => {
    const [user] = await db.select().from(users).limit(1)
    if (!user) return { user: null, events: [], accounts: [] }

    const userAccounts = await getUserAccounts(user.id);
    const userInstruments = await getUserInstruments(user.id);

    const userEvents = await db.query.events.findMany({
      where: and(
        eq(events.userId, user.id),
        data.accountId ? eq(events.accountId, data.accountId) : undefined,
      ),
      orderBy: [desc(events.effectiveAt)],
      limit: 100,
    });

    const eventIds = userEvents.map(e => e.id);

    const eventLegs = await db
      .select()
      .from(legs)
      .where(inArray(legs.eventId, eventIds));

    return { user, events: userEvents, legs: eventLegs, accounts: userAccounts, instruments: userInstruments }
  })

// ─── Route ────────────────────────────────────────────────────────────────────

interface EventsSearch {
  accountId?: string
}

export const Route = createFileRoute('/events/')({
  validateSearch: (search: Record<string, unknown>): EventsSearch => ({
    accountId: typeof search.accountId === 'string' ? search.accountId : undefined,
  }),
  loaderDeps: ({ search }) => ({ accountId: search.accountId }),
  loader: ({ deps }) => getEventsData({ data: deps }),
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
  const { user, accounts, events, legs, instruments } = Route.useLoaderData()
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

  const selectedAccount = accounts.find((a) => a.id === accountId)

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
            {accounts.map((a) => (
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

        <PaginatedTable
          data={events}
          columns={[
            {
              id: 'date',
              header: 'Date',
              cell: ({ row }) => (
                <span className="text-gray-500 dark:text-gray-400 whitespace-nowrap">
                  {formatDate(row.original.effectiveAt)}
                </span>
              ),
            },
            {
              id: 'account',
              header: 'Account',
              cell: ({ row }) => {
                const account = accounts.find((a) => a.id === row.original.accountId)
                return (
                  <span className="text-gray-500 dark:text-gray-400 text-xs truncate max-w-[8rem]">
                    {account?.name ?? '—'}
                  </span>
                )
              }
            },
            {
              id: 'description',
              header: 'Description',
              cell: ({ row }) => (
                <span className="text-gray-900 dark:text-gray-100 font-medium">
                  {row.original.description}
                </span>
              ),
            },
            {
              id: 'change',
              header: 'Change',
              cell: ({ row }) => {
                // show a ticker badge with with the net change (reg/green)
                const eventId = row.original.id;
                const legsForEvent = legs.filter(l => l.eventId === eventId);

                const changesByInstrument: Record<string, bigint> = legsForEvent.reduce((acc, leg) => {
                  const instrumentId = leg.instrumentId;
                  acc[instrumentId] = (acc[instrumentId] || BigInt(0)) + leg.unitCount;
                  return acc;
                }, {} as Record<string, bigint>);

                return (
                  <div>
                    {Object.entries(changesByInstrument).map(([instrumentId, totalUnitCount]) => {
                      const instrument = instruments.find(i => i.id === instrumentId);
                      if (!instrument) return null;

                      const neg = totalUnitCount < 0;
                      const totalAmount = scaleUnit(totalUnitCount, instrument.exponent);

                      return (
                        <Badge key={instrumentId} color={neg ? 'red' : 'green'}>{neg ? '' : '+'}{totalAmount} {instrument.ticker}</Badge>
                      );
                    })}
                  </div>
                )
              },
            },
          ] satisfies ColumnDef<typeof events[number]>[]}
          pagination={{ page: 1, pageSize: 10, totalCount: events.length }}
          onPaginationChange={() => {}}
          hidePagination
          onRowClick={(row) =>
            navigate({ search: (prev) => ({ ...prev, viewEvent: row.id }) })
          }
          getRowId={(row) => row.id}
        >
          <p>No events yet.</p>
        </PaginatedTable>
      </section>
    </div>
  )
}
