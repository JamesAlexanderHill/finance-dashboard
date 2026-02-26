import { createFileRoute, Link } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { eq, and } from 'drizzle-orm'
import { db } from '~/db'
import { users, accounts, events } from '~/db/schema'
import { formatCurrency } from '~/lib/format-currency'

// ─── Server functions ─────────────────────────────────────────────────────────

const getEventDetailData = createServerFn({ method: 'GET' })
  .inputValidator((data: unknown) => data as { accountId: string; eventId: string })
  .handler(async ({ data }) => {
    const [user] = await db.select().from(users).limit(1)
    if (!user) return { user: null, account: null, event: null }

    const [account] = await db
      .select()
      .from(accounts)
      .where(and(eq(accounts.id, data.accountId), eq(accounts.userId, user.id)))

    if (!account) return { user, account: null, event: null }

    const event = await db.query.events.findFirst({
      where: and(eq(events.id, data.eventId), eq(events.accountId, data.accountId)),
      with: {
        legs: {
          with: {
            instrument: true,
            category: true,
          },
        },
      },
    })

    return { user, account, event: event ?? null }
  })

// ─── Route ────────────────────────────────────────────────────────────────────

export const Route = createFileRoute('/accounts/$accountId/events/$eventId')({
  loader: ({ params }) =>
    getEventDetailData({ data: { accountId: params.accountId, eventId: params.eventId } }),
  component: EventDetailPage,
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

function formatDateTime(d: Date | string) {
  return new Date(d).toLocaleDateString('en-AU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

// ─── Component ────────────────────────────────────────────────────────────────

function EventDetailPage() {
  const { user, account, event } = Route.useLoaderData()
  const { accountId } = Route.useParams()

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

  if (!event) {
    return (
      <div className="text-gray-500 dark:text-gray-400 text-sm">
        Event not found.{' '}
        <Link
          to="/accounts/$accountId/events"
          params={{ accountId }}
          className="text-blue-600 dark:text-blue-400 underline"
        >
          Back to events
        </Link>
      </div>
    )
  }

  const badgeClass = EVENT_TYPE_BADGE[event.eventType] ?? ''

  return (
    <div className="max-w-3xl space-y-6">
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
          to="/accounts/$accountId/events"
          params={{ accountId }}
          className="hover:text-blue-600 dark:hover:text-blue-400"
        >
          Events
        </Link>
        <span>/</span>
        <span className="text-gray-900 dark:text-gray-100 truncate max-w-[200px]">{event.description}</span>
      </div>

      {/* Event Details */}
      <section className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-6">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">{event.description}</h1>
            <span className={`inline-block mt-2 text-xs px-2 py-0.5 rounded-full font-medium ${badgeClass}`}>
              {event.eventType}
            </span>
          </div>
        </div>

        <dl className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <dt className="text-gray-500 dark:text-gray-400">Effective Date</dt>
            <dd className="text-gray-900 dark:text-gray-100 font-medium">{formatDateTime(event.effectiveAt)}</dd>
          </div>
          <div>
            <dt className="text-gray-500 dark:text-gray-400">Posted Date</dt>
            <dd className="text-gray-900 dark:text-gray-100 font-medium">{formatDateTime(event.postedAt)}</dd>
          </div>
          <div className="col-span-2">
            <dt className="text-gray-500 dark:text-gray-400">Event ID</dt>
            <dd className="text-gray-900 dark:text-gray-100 font-mono text-xs">{event.id}</dd>
          </div>
          {event.externalId && (
            <div className="col-span-2">
              <dt className="text-gray-500 dark:text-gray-400">External ID</dt>
              <dd className="text-gray-900 dark:text-gray-100 font-mono text-xs">{event.externalId}</dd>
            </div>
          )}
        </dl>
      </section>

      {/* Legs */}
      <section>
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
          Legs ({event.legs.length})
        </h2>

        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50">
                <th className="text-left px-4 py-3 font-medium text-gray-500 dark:text-gray-400">
                  Instrument
                </th>
                <th className="text-right px-4 py-3 font-medium text-gray-500 dark:text-gray-400">
                  Amount
                </th>
                <th className="text-left px-4 py-3 font-medium text-gray-500 dark:text-gray-400">
                  Category
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {event.legs.map((leg: any) => {
                const neg = leg.unitCount < BigInt(0)
                const abs = neg ? -leg.unitCount : leg.unitCount
                return (
                  <tr key={leg.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
                    <td className="px-4 py-3">
                      <Link
                        to="/accounts/$accountId/instruments/$instrumentId"
                        params={{ accountId, instrumentId: leg.instrumentId }}
                        className="text-blue-600 dark:text-blue-400 hover:underline font-medium"
                      >
                        {leg.instrument.name}
                      </Link>
                      <span className="text-gray-400 dark:text-gray-500 ml-1 text-xs">
                        ({leg.instrument.ticker})
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span
                        className={[
                          'font-medium tabular-nums',
                          neg ? 'text-red-600 dark:text-red-400' : 'text-green-700 dark:text-green-400',
                        ].join(' ')}
                      >
                        {formatCurrency(leg.unitCount, {
                          exponent: leg.instrument.exponent,
                          ticker: leg.instrument.ticker,
                        })}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {leg.category ? (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300">
                          {leg.category.name}
                        </span>
                      ) : (
                        <span className="text-gray-400 dark:text-gray-500 text-xs">—</span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
