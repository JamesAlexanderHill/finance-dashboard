import * as React from 'react'
import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { eq, and, desc, isNull, sql } from 'drizzle-orm'
import { db } from '~/db'
import { users, accounts, instruments, events, legs, categories } from '~/db/schema'
import { formatCurrency } from '~/lib/format-currency'
import PaginatedTable, { type ColumnDef } from '~/components/paginated-table'
import Badge from '~/components/atom/badge'

// ─── Server functions ─────────────────────────────────────────────────────────

const getInstrumentDetailData = createServerFn({ method: 'GET' })
  .inputValidator((data: unknown) => data as { accountId: string; instrumentId: string })
  .handler(async ({ data }) => {
    const [user] = await db.select().from(users).limit(1)
    if (!user) return { user: null, account: null, instrument: null, balance: BigInt(0), recentEvents: [] }

    const [account] = await db
      .select()
      .from(accounts)
      .where(and(eq(accounts.id, data.accountId), eq(accounts.userId, user.id)))

    if (!account) return { user, account: null, instrument: null, balance: BigInt(0), recentEvents: [] }

    const [instrument] = await db
      .select()
      .from(instruments)
      .where(and(eq(instruments.id, data.instrumentId), eq(instruments.accountId, data.accountId)))

    if (!instrument) return { user, account, instrument: null, balance: BigInt(0), recentEvents: [] }

    // Calculate balance for this instrument
    const [balanceResult] = await db
      .select({ total: sql<string>`COALESCE(SUM(${legs.unitCount}), 0)` })
      .from(legs)
      .innerJoin(events, eq(legs.eventId, events.id))
      .where(and(eq(legs.instrumentId, data.instrumentId), isNull(events.deletedAt)))

    const balance = BigInt(balanceResult?.total ?? '0')

    // Get recent events that have legs with this instrument
    const recentEventRows = await db
      .select({
        event: events,
        leg: legs,
        category: categories,
      })
      .from(legs)
      .innerJoin(events, eq(legs.eventId, events.id))
      .leftJoin(categories, eq(legs.categoryId, categories.id))
      .where(and(eq(legs.instrumentId, data.instrumentId), isNull(events.deletedAt)))
      .orderBy(desc(events.effectiveAt))
      .limit(20)

    // Group by event
    const eventMap = new Map<string, {
      event: typeof events.$inferSelect
      legs: Array<{ leg: typeof legs.$inferSelect; category: typeof categories.$inferSelect | null }>
    }>()

    for (const row of recentEventRows) {
      if (!eventMap.has(row.event.id)) {
        eventMap.set(row.event.id, { event: row.event, legs: [] })
      }
      eventMap.get(row.event.id)!.legs.push({ leg: row.leg, category: row.category })
    }

    const recentEvents = Array.from(eventMap.values())

    return { user, account, instrument, balance, recentEvents }
  })

const updateInstrument = createServerFn({ method: 'POST' })
  .inputValidator((data: unknown) => data as {
    instrumentId: string
    name: string
    exponent: number
  })
  .handler(async ({ data }) => {
    const [user] = await db.select().from(users).limit(1)
    if (!user) throw new Error('No user found')

    await db
      .update(instruments)
      .set({
        name: data.name.trim(),
        exponent: data.exponent,
      })
      .where(and(eq(instruments.id, data.instrumentId), eq(instruments.userId, user.id)))
  })

// ─── Route ────────────────────────────────────────────────────────────────────

export const Route = createFileRoute('/accounts/$accountId/instruments/$instrumentId')({
  loader: ({ params }) =>
    getInstrumentDetailData({ data: { accountId: params.accountId, instrumentId: params.instrumentId } }),
  component: InstrumentDetailPage,
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

function InstrumentDetailPage() {
  const { user, account, instrument, balance, recentEvents } = Route.useLoaderData()
  const { accountId, instrumentId } = Route.useParams()
  const router = useRouter()
  const navigate = Route.useNavigate()
  const [editing, setEditing] = React.useState(false)

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

  if (!instrument) {
    return (
      <div className="text-gray-500 dark:text-gray-400 text-sm">
        Instrument not found.{' '}
        <Link
          to="/accounts/$accountId/instruments"
          params={{ accountId }}
          className="text-blue-600 dark:text-blue-400 underline"
        >
          Back to instruments
        </Link>
      </div>
    )
  }

  async function handleUpdate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    await updateInstrument({
      data: {
        instrumentId,
        name: String(fd.get('name')),
        kind: String(fd.get('kind')) as 'fiat' | 'security' | 'crypto' | 'other',
        minorUnit: parseInt(String(fd.get('minorUnit')), 10),
      },
    })
    setEditing(false)
    router.invalidate()
  }

  const neg = balance < 0
  const abs = neg ? -balance : balance

  return (
    <div className="max-w-4xl space-y-8">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400 mb-2">
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
            to="/accounts/$accountId/instruments"
            params={{ accountId }}
            className="hover:text-blue-600 dark:hover:text-blue-400"
          >
            Instruments
          </Link>
          <span>/</span>
          <span className="text-gray-900 dark:text-gray-100">{instrument.ticker}</span>
        </div>

        {editing ? (
          <form onSubmit={handleUpdate} className="p-4 bg-gray-50 dark:bg-gray-800 rounded-lg space-y-3 max-w-md">
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                Code (read-only)
              </label>
              <input
                value={instrument.ticker}
                disabled
                className="w-full px-3 py-1.5 text-sm border border-gray-200 dark:border-gray-700 rounded-md bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                Name
              </label>
              <input
                name="name"
                defaultValue={instrument.name}
                required
                className="w-full px-3 py-1.5 text-sm border border-gray-200 dark:border-gray-700 rounded-md bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                  Kind
                </label>
                <select
                  name="kind"
                  defaultValue={instrument.ticker}
                  className="w-full px-3 py-1.5 text-sm border border-gray-200 dark:border-gray-700 rounded-md bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="fiat">Fiat</option>
                  <option value="security">Security</option>
                  <option value="crypto">Crypto</option>
                  <option value="other">Other</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                  Minor Unit
                </label>
                <input
                  name="minorUnit"
                  type="number"
                  min={0}
                  max={8}
                  defaultValue={instrument.exponent}
                  className="w-full px-3 py-1.5 text-sm border border-gray-200 dark:border-gray-700 rounded-md bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
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
              <div className="flex items-center gap-3">
                <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">{instrument.ticker}</h1>
                {account.defaultInstrumentId === instrument.id ? (<Badge>Default</Badge>) : null}
              </div>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{instrument.name}</p>
              <p
                className={[
                  'mt-3 text-2xl font-bold tabular-nums',
                  neg ? 'text-red-600 dark:text-red-400' : 'text-gray-900 dark:text-gray-100',
                ].join(' ')}
              >
                {formatCurrency(balance, {
                  exponent: instrument.exponent,
                  ticker: instrument.ticker,
                })}
                <span className="text-base font-normal text-gray-500 dark:text-gray-400 ml-2">
                  balance
                </span>
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

      {/* Recent Events */}
      <section>
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">Recent Events</h2>

        <PaginatedTable
          data={recentEvents}
          columns={[
            {
              id: 'date',
              header: 'Date',
              cell: ({ row }) => (
                <span className="text-gray-500 dark:text-gray-400 whitespace-nowrap">
                  {formatDate(row.original.event.effectiveAt)}
                </span>
              ),
            },
            {
              id: 'description',
              header: 'Description',
              cell: ({ row }) => (
                <span className="text-gray-900 dark:text-gray-100 font-medium">
                  {row.original.event.description}
                </span>
              ),
            },
            {
              id: 'amount',
              header: 'Amount',
              cell: ({ row }) => {
                const totalAmount = row.original.legs.reduce(
                  (sum, { leg }) => sum + leg.unitCount,
                  BigInt(0)
                )
                const neg = totalAmount < BigInt(0)
                return (
                  <span
                    className={[
                      'font-medium tabular-nums',
                      neg ? 'text-red-600 dark:text-red-400' : 'text-green-700 dark:text-green-400',
                    ].join(' ')}
                  >
                    {formatCurrency(totalAmount, { exponent: instrument.exponent })}
                  </span>
                )
              },
            },
          ] satisfies ColumnDef<typeof recentEvents[number]>[]}
          pagination={{ page: 1, pageSize: 10, totalCount: recentEvents.length }}
          onPaginationChange={() => {}}
          hidePagination
          onRowClick={(row) =>
            navigate({ to: '/events/$eventId', params: { eventId: row.event.id } })
          }
          getRowId={(row) => row.event.id}
        >
          <p>No events yet.</p>
        </PaginatedTable>
      </section>
    </div>
  )
}
