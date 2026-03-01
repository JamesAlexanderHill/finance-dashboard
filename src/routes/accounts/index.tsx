import * as React from 'react'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { eq, inArray, sql, and } from 'drizzle-orm'
import { db } from '~/db'
import { users, accounts, instruments, files } from '~/db/schema'
import PaginatedTable, { type ColumnDef } from '~/components/ui/table'
import { getAccounts, getInstruments } from '~/db/queries'
import Badge from '~/components/ui/badge'
import { formatBalance } from '~/lib/format'

const DEFAULT_PAGE_SIZE = 20

// ─── Server functions ─────────────────────────────────────────────────────────

const getData = createServerFn({ method: 'GET' })
  .inputValidator((data: unknown) => data as { page?: number, pageSize?: number })
  .handler(async ({data}) => {
  const [user] = await db.select().from(users).limit(1)
  if (!user) return { user: null, accounts: [] }

  // paginated events
  const page = data.page ?? 1
  const pageSize = data.pageSize ?? DEFAULT_PAGE_SIZE
  const offset = (page - 1) * pageSize

  // Get accounts with counts
  const userAccounts = await getAccounts(user.id, { limit: pageSize, offset });

  // Get instruent + their balances, account instrument counts, and account import counts
  const [accountInstruments, accountInstrumentCounts, accountImportCounts] = await Promise.all([
    getInstruments(user.id, { accountIds: userAccounts.map((a) => a.id) }),
    db
      .select({
        accountId: instruments.accountId,
        count: sql<number>`count(*)`.as('count'),
      })
      .from(instruments)
      .where(and(
        eq(instruments.userId, user.id),
        inArray(instruments.accountId, userAccounts.map((a) => a.id))
      ))
      .groupBy(instruments.accountId),
    db
      .select({
        accountId: files.accountId,
        count: sql<number>`count(*)`.as('count'),
      })
      .from(files)
      .where(and(
        eq(files.userId, user.id),
        inArray(files.accountId, userAccounts.map((a) => a.id))
      ))
      .groupBy(files.accountId),
  ])

  const accountMetaMap = new Map(userAccounts.map((account) => {
    const instrumentCount = accountInstrumentCounts.find((c) => c.accountId === account.id)?.count ?? 0
    const importCount = accountImportCounts.find((c) => c.accountId === account.id)?.count ?? 0

    return [account.id, {
      instrumentCount: Number(instrumentCount),
      importCount: Number(importCount)
    }];
  }));
  const accountInstrumentsMap = new Map(accountInstruments.map((i) => [i.id, i]));

  return { user, accounts: userAccounts, accountMetaMap, accountInstrumentsMap }
})

const createAccount = createServerFn({ method: 'POST' })
  .inputValidator((data: unknown) => data as { name: string })
  .handler(async ({ data }) => {
    const [user] = await db.select().from(users).limit(1)
    if (!user) throw new Error('No user found')
    await db.insert(accounts).values({
      userId: user.id,
      name: data.name.trim(),
    })
  })

// ─── Route ────────────────────────────────────────────────────────────────────
interface AccountsSearch {
  page?: number
  pageSize?: number
}
export const Route = createFileRoute('/accounts/')({
  validateSearch: (search: Record<string, unknown>): AccountsSearch => ({
    page: typeof search.page === 'number' ? search.page : 1,
    pageSize: typeof search.pageSize === 'number' ? search.pageSize : DEFAULT_PAGE_SIZE,
  }),
  loaderDeps: ({ search }) => ({ page: search.page, pageSize: search.pageSize }),
  loader: ({ deps }) =>
    getData({ data: { page: deps.page, pageSize: deps.pageSize } }),
  component: AccountsPage,
})

// ─── Component ────────────────────────────────────────────────────────────────

function AccountsPage() {
  const { user, accounts, accountMetaMap, accountInstrumentsMap } = Route.useLoaderData()
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
    await createAccount({ data: { name: String(fd.get('name')) } })
    setShowCreate(false)
    router.invalidate()
  }

  const columns: ColumnDef<typeof accounts[0]>[] = [
    {
      id: 'name',
      header: 'Account Name',
      accessorKey: 'name',
      cell: ({ row }) => (
        <span className="text-gray-900 dark:text-gray-100 font-medium">
          {row.original.name}
        </span>
      ),
    },
    {
      id: 'balances',
      header: 'Balances',
      cell: ({ row }) => {
        if (row.original.instruments.length === 0) {
          return (<span className="text-gray-400 dark:text-gray-500 text-xs">—</span>)
        }

        return (
          <div className="flex flex-wrap gap-x-3 gap-y-1">
            {row.original.instruments.map((instrument) => {
              const balance = BigInt(accountInstrumentsMap.get(instrument.id)?.balance ?? '0');
              const colorMap = {
                [1]: 'green',
                [0]: 'gray',
                [-1]: 'red',
              } as Record<number, 'green' | 'red' | 'gray'>;
              const color = colorMap[Math.sign(Number(balance))];

              return (
                <Badge key={instrument.id} color={color}>{formatBalance(balance, instrument)}</Badge>
              )
            })}
          </div>
        )
      }
    },
    {
      id: 'imports',
      header: 'Imports',
      accessorKey: 'importCount',
      cell: ({ row }) => (
        <span className="text-gray-600 dark:text-gray-400 tabular-nums">
          {accountMetaMap.get(row.original.id)?.importCount ?? 0}
        </span>
      ),
    },
    {
      id: 'instruments',
      header: 'Instruments',
      accessorKey: 'instrumentCount',
      cell: ({ row }) => (
        <span className="text-gray-600 dark:text-gray-400 tabular-nums">
          {accountMetaMap.get(row.original.id)?.instrumentCount ?? 0}
        </span>
      ),
    },
    {
      id: 'defaultInstrument',
      header: 'Default Instrument',
      cell: ({ row }) => {
        const defaultInstrument = row.original.defaultInstrumentId
          ? accountInstrumentsMap.get(row.original.defaultInstrumentId)
          : null
        
        if (!defaultInstrument) {
          return (<span className="text-gray-400 dark:text-gray-500 text-xs">—</span>)
        }

        return (
          <span className="text-xs px-2 py-0.5 rounded bg-blue-100 dark:bg-blue-950 text-blue-700 dark:text-blue-300">
            {defaultInstrument?.ticker}
          </span>
        )
      }
    },
  ];

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

      <PaginatedTable
        data={accounts}
        columns={columns}
        pagination={{ page: 1, pageSize: accounts.length, totalCount: accounts.length }}
        onPaginationChange={() => {}}
        hidePagination
        onRowClick={(account) => router.navigate({ to: '/accounts/$accountId', params: { accountId: account.id } })}
        getRowId={(row) => row.id}
      >
        <p>No accounts yet.</p>
      </PaginatedTable>
    </div>
  )
}

// ─── AccountForm helper ───────────────────────────────────────────────────────

function AccountForm({
  defaultName = '',
  onSubmit,
  onCancel,
  submitLabel,
}: {
  defaultName?: string
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
