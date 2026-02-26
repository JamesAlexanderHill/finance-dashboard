import * as React from 'react'
import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { eq, and, desc, isNull, sql } from 'drizzle-orm'
import { db } from '~/db'
import { users, accounts, instruments, events, legs, categories } from '~/db/schema'
import { format } from 'path'
import { formatCurrency } from '~/lib/format-currency'

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

function InstrumentDetailPage() {
  const { user, account, instrument, balance, recentEvents } = Route.useLoaderData()
  const { accountId, instrumentId } = Route.useParams()
  const router = useRouter()
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
                <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400">
                  {instrument.ticker}
                </span>
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

        {recentEvents.length === 0 ? (
          <p className="text-gray-500 dark:text-gray-400 text-sm">No events yet.</p>
        ) : (
          <div className="space-y-3">
            {recentEvents.map(({ event, legs: eventLegs }) => {
              return (
                <div
                  key={event.id}
                  className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl overflow-hidden"
                >
                  {/* Event header */}
                  <div className="px-4 py-3 flex items-center justify-between border-b border-gray-100 dark:border-gray-800">
                    <div className="flex items-center gap-3">
                      <span className="text-sm text-gray-500 dark:text-gray-400">
                        {formatDate(event.effectiveAt)}
                      </span>
                      <Link
                        to="/events/$eventId"
                        params={{ eventId: event.id }}
                        className="font-medium text-gray-900 dark:text-gray-100 hover:text-blue-600 dark:hover:text-blue-400"
                      >
                        {event.description}
                      </Link>
                    </div>
                  </div>

                  {/* Legs for this instrument */}
                  <div className="divide-y divide-gray-100 dark:divide-gray-800">
                    {eventLegs.map(({ leg, category }) => {
                      const legNeg = leg.unitCount < BigInt(0)
                      const legAbs = legNeg ? -leg.unitCount : leg.unitCount
                      return (
                        <div key={leg.id} className="px-4 py-2 flex items-center justify-between">
                          <span
                            className={[
                              'text-sm font-medium tabular-nums',
                              legNeg ? 'text-red-600 dark:text-red-400' : 'text-green-700 dark:text-green-400',
                            ].join(' ')}
                          >
                            {legNeg ? '−' : '+'}
                            {formatCurrency(leg.unitCount, {
                              exponent: instrument.exponent,
                              // ticker: leg.instrumentId.ticker,// TODO: this needs to be the ticker of the current leg, not the main instrument
                            })}
                          </span>
                          {category && (
                            <span className="text-xs text-gray-500 dark:text-gray-400">
                              {category.name}
                            </span>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </section>
    </div>
  )
}
