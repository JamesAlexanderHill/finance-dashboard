import { createFileRoute, Link } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { eq, and, desc, sql } from 'drizzle-orm'
import { db } from '~/db'
import { users, accounts, files } from '~/db/schema'
import PaginatedTable, { type ColumnDef } from '~/components/ui/table'

// ─── Server functions ─────────────────────────────────────────────────────────

const getFilesData = createServerFn({ method: 'GET' })
  .inputValidator((data: unknown) => data as { accountId: string; page?: number; pageSize?: number })
  .handler(async ({ data }) => {
    const [user] = await db.select().from(users).limit(1)
    if (!user) return { user: null, account: null, files: [], totalCount: 0, page: 1, pageSize: 20 }

    const [account] = await db
      .select()
      .from(accounts)
      .where(and(eq(accounts.id, data.accountId), eq(accounts.userId, user.id)))

    if (!account) return { user, account: null, files: [], totalCount: 0, page: 1, pageSize: 20 }

    const page = data.page ?? 1
    const pageSize = data.pageSize ?? 20
    const offset = (page - 1) * pageSize

    const [fileData, countResult] = await Promise.all([
      db
        .select()
        .from(files)
        .where(and(eq(files.accountId, data.accountId)))
        .orderBy(desc(files.createdAt))
        .limit(pageSize)
        .offset(offset),
      db
        .select({ count: sql<number>`count(*)` })
        .from(files)
        .where(and(eq(files.accountId, data.accountId))),
    ])

    return {
      user,
      account,
      files: fileData,
      totalCount: Number(countResult[0]?.count ?? 0),
      page,
      pageSize,
    }
  })

// ─── Route ────────────────────────────────────────────────────────────────────

const DEFAULT_PAGE_SIZE = 20

interface FilesSearch {
  page?: number
  pageSize?: number
}

export const Route = createFileRoute('/accounts/$accountId/files/')({
  validateSearch: (search: Record<string, unknown>): FilesSearch => ({
    page: typeof search.page === 'number' ? search.page : 1,
    pageSize: typeof search.pageSize === 'number' ? search.pageSize : DEFAULT_PAGE_SIZE,
  }),
  loaderDeps: ({ search }) => ({ page: search.page, pageSize: search.pageSize }),
  loader: ({ params, deps }) =>
    getFilesData({ data: { accountId: params.accountId, page: deps.page, pageSize: deps.pageSize } }),
  component: FilesPage,
})

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

function FilesPage() {
  const { user, account, files, totalCount, page, pageSize } = Route.useLoaderData()
  const { accountId } = Route.useParams()
  const navigate = Route.useNavigate()

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
        <span className="text-gray-900 dark:text-gray-100">Files</span>
      </div>

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">Files</h1>
        <span className="text-sm text-gray-500 dark:text-gray-400">
          {totalCount} file{totalCount !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Table */}
      <PaginatedTable
        data={files}
        columns={[
          {
            id: 'date',
            header: 'File Date/Time',
            accessorKey: 'createdAt',
            cell: ({ getValue }) => (
              <span className="text-gray-500 dark:text-gray-400 whitespace-nowrap">
                {formatDateTime(getValue() as Date)}
              </span>
            ),
          },
          {
            id: 'filename',
            header: 'File Name',
            accessorKey: 'filename',
            cell: ({ row }) => (
              <span className="text-gray-900 dark:text-gray-100 font-medium">
                {row.original.filename}
              </span>
            ),
          },
          {
            id: 'imported',
            header: 'Imported',
            accessorKey: 'importedCount',
            cell: ({ getValue }) => (
              <span className="text-green-700 dark:text-green-400 tabular-nums">
                {getValue() as number}
              </span>
            ),
          },
          {
            id: 'skipped',
            header: 'Skipped',
            accessorKey: 'skippedCount',
            cell: ({ getValue }) => (
              <span className="text-gray-500 dark:text-gray-400 tabular-nums">
                {getValue() as number}
              </span>
            ),
          },
          {
            id: 'errors',
            header: 'Errors',
            accessorKey: 'errorCount',
            cell: ({ getValue }) => {
              const count = getValue() as number
              return (
                <span
                  className={
                    count > 0
                      ? 'text-red-600 dark:text-red-400 tabular-nums'
                      : 'text-gray-400 dark:text-gray-500 tabular-nums'
                  }
                >
                  {count}
                </span>
              )
            },
          },
        ] satisfies ColumnDef<typeof files[number]>[]}
        pagination={{ page, pageSize, totalCount }}
        onPaginationChange={(p) => navigate({ search: p })}
        onRowClick={(file) =>
          navigate({
            to: '/accounts/$accountId/files/$fileId',
            params: { accountId, fileId: file.id },
          })
        }
        getRowId={(row) => row.id}
      >
        <p>No files yet.</p>
      </PaginatedTable>
    </div>
  )
}
