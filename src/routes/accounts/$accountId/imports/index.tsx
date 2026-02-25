import * as React from 'react'
import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { eq, and } from 'drizzle-orm'
import { db } from '~/db'
import { users, accounts, importRuns } from '~/db/schema'
import { getUserBalances, formatAmount } from '~/lib/balance'

// ─── Server functions ─────────────────────────────────────────────────────────

const getImportsData = createServerFn({ method: 'GET' })
  .inputValidator((data: unknown) => data as { accountId: string })
  .handler(async ({ data }) => {
    const [user] = await db.select().from(users).limit(1)
    if (!user) return { user: null, account: null, imports: [], balances: [] }

    const [account] = await db
      .select()
      .from(accounts)
      .where(and(eq(accounts.id, data.accountId), eq(accounts.userId, user.id)))

    if (!account) return { user, account: null, imports: [], balances: [] }

    const [accountImports, allBalances] = await Promise.all([
      db.select().from(importRuns).where(eq(importRuns.accountId, data.accountId)),
      getUserBalances(user.id),
    ])

    const balances = allBalances.filter((b) => b.accountId === data.accountId)

    return { user, account, imports: accountImports, balances }
  })

// ─── Route ────────────────────────────────────────────────────────────────────

export const Route = createFileRoute('/accounts/$accountId/imports/')({
  loader: ({ params }) => getImportsData({ data: { accountId: params.accountId } }),
  component: ImportsPage,
})

// ─── Component ────────────────────────────────────────────────────────────────

function ImportsPage() {
  const { user, account, imports, balances } = Route.useLoaderData()
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
          <span className="text-gray-900 dark:text-gray-100">Imports</span>
        </div>

      </div>

      {/* Instruments list */}
      {imports.length === 0 ? (
        <p className="text-gray-500 dark:text-gray-400 text-sm">No imports yet.</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {imports.map((importItem) => {
            const balance = balances.find((b) => b.instrumentId === importItem.id)
            const amountMinor = balance?.amountMinor ?? BigInt(0)
            const neg = amountMinor < 0
            const abs = neg ? -amountMinor : amountMinor

            return (
              <Link
                key={importItem.id}
                to="/accounts/$accountId/instruments/$instrumentId"
                params={{ accountId, instrumentId: importItem.id }}
                className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4 hover:border-blue-300 dark:hover:border-blue-700 transition-colors"
              >
                <div className="flex items-start justify-between">
                  <div>
                    <p className="font-medium text-gray-900 dark:text-gray-100">{importItem.filename}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">{importItem.importedCount}</p>
                  </div>
                </div>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
