import * as React from 'react'
import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { eq, and } from 'drizzle-orm'
import { db } from '~/db'
import { users, accounts, instruments } from '~/db/schema'
import { getUserBalances, formatAmount } from '~/lib/balance'
import type { Instrument } from '~/db/schema'

// ─── Server functions ─────────────────────────────────────────────────────────

const getInstrumentsData = createServerFn({ method: 'GET' })
  .inputValidator((data: unknown) => data as { accountId: string })
  .handler(async ({ data }) => {
    const [user] = await db.select().from(users).limit(1)
    if (!user) return { user: null, account: null, instruments: [], balances: [] }

    const [account] = await db
      .select()
      .from(accounts)
      .where(and(eq(accounts.id, data.accountId), eq(accounts.userId, user.id)))

    if (!account) return { user, account: null, instruments: [], balances: [] }

    const [accountInstruments, allBalances] = await Promise.all([
      db.select().from(instruments).where(eq(instruments.accountId, data.accountId)),
      getUserBalances(user.id),
    ])

    const balances = allBalances.filter((b) => b.accountId === data.accountId)

    return { user, account, instruments: accountInstruments, balances }
  })

const createInstrument = createServerFn({ method: 'POST' })
  .inputValidator((data: unknown) => data as {
    accountId: string
    code: string
    name: string
    kind: 'fiat' | 'security' | 'crypto' | 'other'
    minorUnit: number
  })
  .handler(async ({ data }) => {
    const [user] = await db.select().from(users).limit(1)
    if (!user) throw new Error('No user found')

    // Verify account belongs to user
    const [account] = await db
      .select()
      .from(accounts)
      .where(and(eq(accounts.id, data.accountId), eq(accounts.userId, user.id)))

    if (!account) throw new Error('Account not found')

    await db.insert(instruments).values({
      userId: user.id,
      accountId: data.accountId,
      code: data.code.trim().toUpperCase(),
      name: data.name.trim(),
      kind: data.kind,
      minorUnit: data.minorUnit,
    })
  })

// ─── Route ────────────────────────────────────────────────────────────────────

export const Route = createFileRoute('/accounts/$accountId/instruments/')({
  loader: ({ params }) => getInstrumentsData({ data: { accountId: params.accountId } }),
  component: InstrumentsPage,
})

// ─── Component ────────────────────────────────────────────────────────────────

function InstrumentsPage() {
  const { user, account, instruments, balances } = Route.useLoaderData()
  const { accountId } = Route.useParams()
  const router = useRouter()
  const [showCreate, setShowCreate] = React.useState(false)

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

  async function handleCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    await createInstrument({
      data: {
        accountId,
        code: String(fd.get('code')),
        name: String(fd.get('name')),
        kind: String(fd.get('kind')) as 'fiat' | 'security' | 'crypto' | 'other',
        minorUnit: parseInt(String(fd.get('minorUnit')), 10),
      },
    })
    setShowCreate(false)
    router.invalidate()
  }

  return (
    <div className="max-w-4xl">
      {/* Header */}
      <div className="mb-6">
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
          <span className="text-gray-900 dark:text-gray-100">Instruments</span>
        </div>

        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">Instruments</h1>
          <button
            onClick={() => setShowCreate(true)}
            className="px-3 py-1.5 text-sm font-medium bg-blue-600 hover:bg-blue-700 text-white rounded-md transition-colors"
          >
            + New Instrument
          </button>
        </div>
      </div>

      {/* Create form */}
      {showCreate && (
        <form onSubmit={handleCreate} className="mb-6 p-4 bg-gray-50 dark:bg-gray-800 rounded-lg space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                Code
              </label>
              <input
                name="code"
                required
                placeholder="e.g., AUD, USD, VDAL"
                className="w-full px-3 py-1.5 text-sm border border-gray-200 dark:border-gray-700 rounded-md bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                Name
              </label>
              <input
                name="name"
                required
                placeholder="e.g., Australian Dollar"
                className="w-full px-3 py-1.5 text-sm border border-gray-200 dark:border-gray-700 rounded-md bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                Kind
              </label>
              <select
                name="kind"
                defaultValue="fiat"
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
                Minor Unit (decimal places)
              </label>
              <input
                name="minorUnit"
                type="number"
                min={0}
                max={8}
                defaultValue={2}
                className="w-full px-3 py-1.5 text-sm border border-gray-200 dark:border-gray-700 rounded-md bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>
          <div className="flex gap-2">
            <button
              type="submit"
              className="px-3 py-1.5 text-sm font-medium bg-blue-600 hover:bg-blue-700 text-white rounded-md"
            >
              Create
            </button>
            <button
              type="button"
              onClick={() => setShowCreate(false)}
              className="px-3 py-1.5 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* Instruments list */}
      {instruments.length === 0 ? (
        <p className="text-gray-500 dark:text-gray-400 text-sm">No instruments yet.</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {instruments.map((instrument) => {
            const balance = balances.find((b) => b.instrumentId === instrument.id)
            const amountMinor = balance?.amountMinor ?? BigInt(0)
            const neg = amountMinor < 0
            const abs = neg ? -amountMinor : amountMinor

            return (
              <Link
                key={instrument.id}
                to="/accounts/$accountId/instruments/$instrumentId"
                params={{ accountId, instrumentId: instrument.id }}
                className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4 hover:border-blue-300 dark:hover:border-blue-700 transition-colors"
              >
                <div className="flex items-start justify-between">
                  <div>
                    <p className="font-medium text-gray-900 dark:text-gray-100">{instrument.code}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">{instrument.name}</p>
                  </div>
                  <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400">
                    {instrument.kind}
                  </span>
                </div>
                <p
                  className={[
                    'mt-3 text-lg font-semibold tabular-nums',
                    neg ? 'text-red-600 dark:text-red-400' : 'text-gray-900 dark:text-gray-100',
                  ].join(' ')}
                >
                  {neg ? '−' : ''}
                  {formatAmount(abs, instrument.minorUnit)}
                </p>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
