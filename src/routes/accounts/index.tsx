import * as React from 'react'
import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { eq, and } from 'drizzle-orm'
import { db } from '~/db'
import { users, accounts, instruments } from '~/db/schema'
import { getUserBalances, formatAmount } from '~/lib/balance'

// ─── Server functions ─────────────────────────────────────────────────────────

const getAccountsData = createServerFn({ method: 'GET' }).handler(async () => {
  const [user] = await db.select().from(users).limit(1)
  if (!user) return { user: null, accounts: [], balances: [] }

  const [userAccounts, balances] = await Promise.all([
    db.select().from(accounts).where(eq(accounts.userId, user.id)),
    getUserBalances(user.id),
  ])

  return { user, accounts: userAccounts, balances }
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

const updateAccount = createServerFn({ method: 'POST' })
  .inputValidator((data: unknown) => data as { id: string; name: string; importerKey: string })
  .handler(async ({ data }) => {
    const [user] = await db.select().from(users).limit(1)
    if (!user) throw new Error('No user found')
    await db
      .update(accounts)
      .set({ name: data.name.trim(), importerKey: data.importerKey.trim() })
      .where(and(eq(accounts.id, data.id), eq(accounts.userId, user.id)))
  })

// ─── Route ────────────────────────────────────────────────────────────────────

export const Route = createFileRoute('/accounts/')({
  loader: () => getAccountsData(),
  component: AccountsPage,
})

// ─── Component ────────────────────────────────────────────────────────────────

function AccountsPage() {
  const { user, accounts, balances } = Route.useLoaderData()
  const router = useRouter()
  const [editingId, setEditingId] = React.useState<string | null>(null)
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

  // Group balances by account
  const balancesByAccount = new Map<string, typeof balances>()
  for (const b of balances) {
    if (!balancesByAccount.has(b.accountId)) balancesByAccount.set(b.accountId, [])
    balancesByAccount.get(b.accountId)!.push(b)
  }

  async function handleCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    await createAccount({ data: { name: String(fd.get('name')), importerKey: String(fd.get('importerKey')) } })
    setShowCreate(false)
    router.invalidate()
  }

  async function handleUpdate(e: React.FormEvent<HTMLFormElement>, id: string) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    await updateAccount({ data: { id, name: String(fd.get('name')), importerKey: String(fd.get('importerKey')) } })
    setEditingId(null)
    router.invalidate()
  }

  return (
    <div className="max-w-3xl">
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
        <div className="space-y-3">
          {accounts.map((account) => {
            const acctBalances = balancesByAccount.get(account.id) ?? []
            const isEditing = editingId === account.id

            return (
              <div
                key={account.id}
                className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4"
              >
                {isEditing ? (
                  <AccountForm
                    defaultName={account.name}
                    defaultImporterKey={account.importerKey}
                    onSubmit={(e) => handleUpdate(e, account.id)}
                    onCancel={() => setEditingId(null)}
                    submitLabel="Save"
                  />
                ) : (
                  <div className="flex items-start justify-between gap-4">
                    {/* Account info + balances */}
                    <div className="flex-1">
                      <Link
                        to="/accounts/$accountId"
                        params={{ accountId: account.id }}
                        className="text-base font-medium text-gray-900 dark:text-gray-100 hover:text-blue-600 dark:hover:text-blue-400"
                      >
                        {account.name}
                      </Link>
                      <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                        importer: {account.importerKey}
                      </p>

                      {acctBalances.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
                          {acctBalances.map((b) => {
                            const neg = b.amountMinor < 0
                            const abs = neg ? -b.amountMinor : b.amountMinor
                            return (
                              <span
                                key={b.instrumentId}
                                className={[
                                  'text-sm tabular-nums',
                                  neg ? 'text-red-600 dark:text-red-400' : 'text-gray-700 dark:text-gray-300',
                                ].join(' ')}
                              >
                                {neg ? '−' : ''}{formatAmount(abs, b.instrumentMinorUnit)}{' '}
                                <span className="text-xs text-gray-400 dark:text-gray-500">
                                  {b.instrumentCode}
                                </span>
                              </span>
                            )
                          })}
                        </div>
                      )}
                    </div>

                    {/* Actions */}
                    <button
                      onClick={() => setEditingId(account.id)}
                      className="text-xs text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
                    >
                      Edit
                    </button>
                  </div>
                )}
              </div>
            )
          })}
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
