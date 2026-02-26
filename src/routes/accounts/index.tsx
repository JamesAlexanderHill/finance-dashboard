import * as React from 'react'
import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { eq, sql } from 'drizzle-orm'
import { db } from '~/db'
import { users, accounts, instruments, files } from '~/db/schema'
import { getUserBalances } from '~/lib/balance'
import { formatCurrency } from '~/lib/format-currency'

// ─── Server functions ─────────────────────────────────────────────────────────

const getAccountsData = createServerFn({ method: 'GET' }).handler(async () => {
  const [user] = await db.select().from(users).limit(1)
  if (!user) return { user: null, accounts: [] }

  // Get accounts with counts
  const userAccounts = await db.select().from(accounts).where(eq(accounts.userId, user.id))

  // Get balances, instrument counts, and import counts
  const [balances, instrumentCounts, importCounts, allInstruments] = await Promise.all([
    getUserBalances(user.id),
    db
      .select({
        accountId: instruments.accountId,
        count: sql<number>`count(*)`.as('count'),
      })
      .from(instruments)
      .where(eq(instruments.userId, user.id))
      .groupBy(instruments.accountId),
    db
      .select({
        accountId: files.accountId,
        count: sql<number>`count(*)`.as('count'),
      })
      .from(files)
      .where(eq(files.userId, user.id))
      .groupBy(files.accountId),
    db.select().from(instruments).where(eq(instruments.userId, user.id)),
  ])

  // Build account data with all info
  const accountsWithData = userAccounts.map((account) => {
    const acctBalances = balances.filter((b) => b.accountId === account.id)
    const instrumentCount = instrumentCounts.find((c) => c.accountId === account.id)?.count ?? 0
    const importCount = importCounts.find((c) => c.accountId === account.id)?.count ?? 0
    const defaultInstrument = account.defaultInstrumentId
      ? allInstruments.find((i) => i.id === account.defaultInstrumentId)
      : null

    return {
      ...account,
      balances: acctBalances,
      instrumentCount: Number(instrumentCount),
      importCount: Number(importCount),
      defaultInstrument,
    }
  })

  return { user, accounts: accountsWithData }
})

const createAccount = createServerFn({ method: 'POST' })
  .inputValidator((data: unknown) => data as { name: string; importerKey: string })
  .handler(async ({ data }) => {
    const [user] = await db.select().from(users).limit(1)
    if (!user) throw new Error('No user found')
    await db.insert(accounts).values({
      userId: user.id,
      name: data.name.trim(),
      importerKey: data.importerKey.trim() || 'canonical_csv_v1',
    })
  })

// ─── Route ────────────────────────────────────────────────────────────────────

export const Route = createFileRoute('/accounts/')({
  loader: () => getAccountsData(),
  component: AccountsPage,
})

// ─── Component ────────────────────────────────────────────────────────────────

function AccountsPage() {
  const { user, accounts } = Route.useLoaderData()
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

  async function handleCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    await createAccount({ data: { name: String(fd.get('name')), importerKey: String(fd.get('importerKey')) } })
    setShowCreate(false)
    router.invalidate()
  }

  return (
    <div className="max-w-5xl">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">Accounts</h1>
        <button
          onClick={() => setShowCreate(true)}
          className="px-3 py-1.5 text-sm font-medium bg-blue-600 hover:bg-blue-700 text-white rounded-md transition-colors"
        >
          + New Account
        </button>
      </div>

      {/* Create form */}
      {showCreate && (
        <AccountForm
          onSubmit={handleCreate}
          onCancel={() => setShowCreate(false)}
          submitLabel="Create"
        />
      )}

      {accounts.length === 0 ? (
        <p className="text-gray-500 dark:text-gray-400 text-sm">No accounts yet.</p>
      ) : (
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50">
                <th className="text-left px-4 py-3 font-medium text-gray-500 dark:text-gray-400">
                  Account Name
                </th>
                <th className="text-left px-4 py-3 font-medium text-gray-500 dark:text-gray-400">
                  Balances
                </th>
                <th className="text-right px-4 py-3 font-medium text-gray-500 dark:text-gray-400">
                  Imports
                </th>
                <th className="text-right px-4 py-3 font-medium text-gray-500 dark:text-gray-400">
                  Instruments
                </th>
                <th className="text-left px-4 py-3 font-medium text-gray-500 dark:text-gray-400">
                  Default Instrument
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {accounts.map((account) => (
                <tr
                  key={account.id}
                  className="hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
                >
                  <td className="px-4 py-3">
                    <Link
                      to="/accounts/$accountId"
                      params={{ accountId: account.id }}
                      className="text-gray-900 dark:text-gray-100 hover:text-blue-600 dark:hover:text-blue-400 font-medium"
                    >
                      {account.name}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    {account.balances.length === 0 ? (
                      <span className="text-gray-400 dark:text-gray-500 text-xs">—</span>
                    ) : (
                      <div className="flex flex-wrap gap-x-3 gap-y-1">
                        {account.balances.map((b) => {
                          const neg = b.unitCount < 0
                          const abs = neg ? -b.unitCount : b.unitCount
                          return (
                            <span
                              key={b.instrumentId}
                              className={[
                                'text-xs tabular-nums',
                                neg ? 'text-red-600 dark:text-red-400' : 'text-gray-700 dark:text-gray-300',
                              ].join(' ')}
                            >
                              {formatCurrency(b.unitCount, {
                                exponent: b.instrumentExponent,
                                ticker: b.instrumentTicker,
                              })}
                              <span className="text-gray-400 dark:text-gray-500">{b.instrumentTicker}</span>
                            </span>
                          )
                        })}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right text-gray-600 dark:text-gray-400 tabular-nums">
                    {account.importCount}
                  </td>
                  <td className="px-4 py-3 text-right text-gray-600 dark:text-gray-400 tabular-nums">
                    {account.instrumentCount}
                  </td>
                  <td className="px-4 py-3 text-gray-600 dark:text-gray-400">
                    {account.defaultInstrument ? (
                      <span className="text-xs px-2 py-0.5 rounded bg-blue-100 dark:bg-blue-950 text-blue-700 dark:text-blue-300">
                        {account.defaultInstrument.ticker}
                      </span>
                    ) : (
                      <span className="text-gray-400 dark:text-gray-500 text-xs">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ─── AccountForm helper ───────────────────────────────────────────────────────

function AccountForm({
  defaultName = '',
  defaultImporterKey = 'canonical_csv_v1',
  onSubmit,
  onCancel,
  submitLabel,
}: {
  defaultName?: string
  defaultImporterKey?: string
  onSubmit: (e: React.FormEvent<HTMLFormElement>) => void
  onCancel: () => void
  submitLabel: string
}) {
  return (
    <form onSubmit={onSubmit} className="mb-4 p-4 bg-gray-50 dark:bg-gray-800 rounded-lg space-y-3">
      <div>
        <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
          Name
        </label>
        <input
          name="name"
          defaultValue={defaultName}
          required
          className="w-full px-3 py-1.5 text-sm border border-gray-200 dark:border-gray-700 rounded-md bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
          Importer Key
        </label>
        <input
          name="importerKey"
          defaultValue={defaultImporterKey}
          className="w-full px-3 py-1.5 text-sm border border-gray-200 dark:border-gray-700 rounded-md bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>
      <div className="flex gap-2">
        <button
          type="submit"
          className="px-3 py-1.5 text-sm font-medium bg-blue-600 hover:bg-blue-700 text-white rounded-md"
        >
          {submitLabel}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="px-3 py-1.5 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100"
        >
          Cancel
        </button>
      </div>
    </form>
  )
}
