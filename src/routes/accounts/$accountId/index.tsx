import * as React from 'react'
import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { ImportWizard } from '~/components/ImportWizard'
import { BulkImportWizard } from '~/components/BulkImportWizard'
import InstrumentCard from '~/components/instrument-card'
import BalanceHistogram, { type InstrumentRates } from '~/components/balance-histogram'
import PaginatedTable, { type ColumnDef } from '~/components/ui/table'
import EventPreviewTable from '~/components/event/event-preview-table'
import { accountService, annotationService, eventService, fileService, instrumentService, rateService, getSession } from '~/db/services'
import type { TimelineAnnotation } from '~/db/schema'
import type { RecurrenceRule } from '~/lib/timeline-annotations'
import { defaultBalanceHistoryRange, serializeRange } from '~/lib/date-range'
import AccountColorSelect from '~/components/ui/account-color-select'
import type { AccountColorName } from '~/lib/chart-colors'

// ─── Server functions ─────────────────────────────────────────────────────────

const getData = createServerFn({ method: 'GET' })
  .inputValidator((data: unknown) => data as { accountId: string })
  .handler(async ({ data }) => {
    const session = await getSession()
    if (!session) return { user: null, workspace: null, account: null, accountInstruments: [], recentAccountfiles: [], recentAccountEvents: [], balanceHistory: [], chartInstrument: null, rates: {} as InstrumentRates }

    const { ctx, user, workspace } = session
    const account = await accountService.getById(ctx, data.accountId)

    if (!account) return { user, workspace, account: null, accountInstruments: [], recentAccountfiles: [], recentAccountEvents: [], balanceHistory: [], chartInstrument: null, rates: {} as InstrumentRates }

    const accountInstruments = await instrumentService.list(ctx, { accountIds: [data.accountId] })

    const chartInstrument =
      accountInstruments.data.find((i) => i.id === account.defaultInstrumentId) ?? accountInstruments.data[0] ?? null

    const [recentAccountfiles, recentAccountEvents, balanceHistory, ratesMap, annotations] = await Promise.all([
      fileService.listByAccount(ctx, data.accountId, { limit: 5 }),
      eventService.listByAccount(ctx, data.accountId, { limit: 10 }),
      chartInstrument ? instrumentService.getBalanceHistory(ctx, chartInstrument.id, serializeRange(defaultBalanceHistoryRange()), 'day') : Promise.resolve([]),
      rateService.getRates(ctx, accountInstruments.data.map((i) => i.id)),
      annotationService.listByAccount(ctx, data.accountId),
    ]);

    const rates: InstrumentRates = Object.fromEntries(
      Array.from(ratesMap.entries()).map(([id, r]) => [id, { rate: r.rate, asOf: r.asOf.toISOString(), source: r.source }]),
    )

    return { user, workspace, account, accountInstruments, recentAccountfiles, recentAccountEvents, balanceHistory, chartInstrument, rates, annotations }
  })

const updateAccount = createServerFn({ method: 'POST' })
  .inputValidator((data: unknown) => data as { id: string; name: string; defaultInstrumentId: string | null; color: AccountColorName | null })
  .handler(async ({ data }) => {
    const session = await getSession()
    if (!session) throw new Error('No user found')
    await accountService.update(session.ctx, data.id, {
      name: data.name,
      defaultInstrumentId: data.defaultInstrumentId,
      color: data.color,
    })
  })

const createAnnotation = createServerFn({ method: 'POST' })
  .inputValidator((data: unknown) => data as { accountId: string; label: string; date: string; recurrence: RecurrenceRule | null })
  .handler(async ({ data }) => {
    const session = await getSession()
    if (!session) throw new Error('No user found')
    await annotationService.create(session.ctx, {
      accountId: data.accountId,
      label: data.label,
      date: new Date(data.date),
      recurrence: data.recurrence,
    })
  })

const updateAnnotation = createServerFn({ method: 'POST' })
  .inputValidator((data: unknown) => data as { id: string; label: string; date: string; recurrence: RecurrenceRule | null })
  .handler(async ({ data }) => {
    const session = await getSession()
    if (!session) throw new Error('No user found')
    await annotationService.update(session.ctx, data.id, {
      label: data.label,
      date: new Date(data.date),
      recurrence: data.recurrence,
    })
  })

const deleteAnnotation = createServerFn({ method: 'POST' })
  .inputValidator((data: unknown) => data as { id: string })
  .handler(async ({ data }) => {
    const session = await getSession()
    if (!session) throw new Error('No user found')
    await annotationService.delete(session.ctx, data.id)
  })

// ─── Route ────────────────────────────────────────────────────────────────────

export const Route = createFileRoute('/accounts/$accountId/')({
  loader: ({ params }) => getData({ data: { accountId: params.accountId } }),
  component: AccountDetailPage,
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

function AccountDetailPage() {
  const { user, workspace, account, accountInstruments, recentAccountfiles, recentAccountEvents, balanceHistory, chartInstrument, rates, annotations } = Route.useLoaderData()
  const { accountId } = Route.useParams()
  const router = useRouter()
  const [editing, setEditing] = React.useState(false)
  const [showImportWizard, setShowImportWizard] = React.useState(false)
  const [showBulkImportWizard, setShowBulkImportWizard] = React.useState(false)
  const [showAnnotationForm, setShowAnnotationForm] = React.useState(false)
  const [editingAnnotation, setEditingAnnotation] = React.useState<TimelineAnnotation | null>(null)
  const navigate = Route.useNavigate()

  if (!user || !workspace) {
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

  async function handleUpdate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    await updateAccount({
      data: {
        id: account!.id,
        name: String(fd.get('name')),
        defaultInstrumentId: String(fd.get('defaultInstrumentId')) || null,
        color: (String(fd.get('color')) || null) as AccountColorName | null,
      },
    })
    setEditing(false)
    router.invalidate()
  }

  // Sort instruments: default first, then by balance (descending)
  const sortedInstruments = [...accountInstruments.data].sort((a, b) => {
    // Default instrument first
    if (a.id === account.defaultInstrumentId) return -1
    if (b.id === account.defaultInstrumentId) return 1
    // Then by balance (higher first)
    const balA = BigInt(a.balance);
    const balB = BigInt(b.balance);
    if (balB > balA) return 1
    if (balB < balA) return -1
    return 0
  })

  const defaultInstrument = accountInstruments.data.find((i) => i.id === account.defaultInstrumentId)

  const filesColumns: ColumnDef<typeof recentAccountfiles.data[number]>[] = [
    {
      id: 'date',
      header: 'Date',
      accessorKey: 'createdAt',
      cell: ({ getValue }) => (
        <span className="text-gray-500 dark:text-gray-400 whitespace-nowrap">
          {formatDateTime(getValue() as Date)}
        </span>
      ),
    },
    {
      id: 'filename',
      header: 'Filename',
      accessorKey: 'filename',
      cell: ({ row }) => (
        <span className="text-gray-900 dark:text-gray-100 font-medium">
          {row.original.filename}
        </span>
      ),
    },
    {
      id: 'stats',
      header: 'Results',
      cell: ({ row }) => (
        <div className="flex items-center gap-3 text-xs">
          <span className="text-green-700 dark:text-green-400 tabular-nums">
            {row.original.importedCount} imported
          </span>
          <span className="text-gray-400 dark:text-gray-500 tabular-nums">
            {row.original.skippedCount} skipped
          </span>
          {row.original.errorCount > 0 && (
            <span className="text-red-600 dark:text-red-400 tabular-nums">
              {row.original.errorCount} errors
            </span>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="max-w-5xl space-y-8">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
        <Link to="/accounts" className="hover:text-blue-600 dark:hover:text-blue-400">
          Accounts
        </Link>
        <span>/</span>
        <span className="text-gray-900 dark:text-gray-100">{account.name}</span>
      </div>

      {/* Section A: Account Details */}
      <section className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-6">
        {editing ? (
          <form onSubmit={handleUpdate} className="space-y-4 max-w-md">
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                Name
              </label>
              <input
                name="name"
                defaultValue={account.name}
                required
                className="w-full px-3 py-1.5 text-sm border border-gray-200 dark:border-gray-700 rounded-md bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                Default Instrument
              </label>
              <select
                name="defaultInstrumentId"
                defaultValue={account.defaultInstrumentId ?? ''}
                className="w-full px-3 py-1.5 text-sm border border-gray-200 dark:border-gray-700 rounded-md bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">None</option>
                {accountInstruments.data.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.ticker} - {i.name}
                  </option>
                ))}
              </select>
            </div>
            <AccountColorSelect name="color" defaultValue={account.color} />
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
              <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">{account.name}</h1>
              <div className="flex items-center gap-4 mt-2 text-sm text-gray-500 dark:text-gray-400">
                <span>
                  Default:{' '}
                  {defaultInstrument ? (
                    <span className="text-blue-600 dark:text-blue-400">{defaultInstrument.ticker}</span>
                  ) : (
                    <span className="text-gray-400 dark:text-gray-500">None</span>
                  )}
                </span>
              </div>
            </div>
            <button
              onClick={() => setEditing(true)}
              className="px-3 py-1.5 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 border border-gray-200 dark:border-gray-700 rounded-md"
            >
              Edit
            </button>
          </div>
        )}
      </section>

      {/* Section A.5: Balance Histogram */}
      {accountInstruments.data.length > 0 && (
        <BalanceHistogram
          instruments={accountInstruments.data}
          accounts={[{ id: account.id, color: account.color }]}
          defaultInstrumentId={chartInstrument?.id ?? null}
          initialData={balanceHistory}
          rates={rates}
          homeCurrencyCode={user!.homeCurrencyCode}
          annotations={annotations.data}
        />
      )}

      {/* Section A.7: Annotations */}
      <section className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Annotations</h2>
          {!showAnnotationForm && !editingAnnotation && (
            <button
              onClick={() => setShowAnnotationForm(true)}
              className="px-3 py-1.5 text-sm font-medium bg-blue-600 hover:bg-blue-700 text-white rounded-md transition-colors"
            >
              + Add Annotation
            </button>
          )}
        </div>

        {(showAnnotationForm || editingAnnotation) && (
          <AnnotationForm
            accountId={account.id}
            annotation={editingAnnotation}
            onSave={async (formData) => {
              if (editingAnnotation) {
                await updateAnnotation({ data: { id: editingAnnotation.id, ...formData } })
                setEditingAnnotation(null)
              } else {
                await createAnnotation({ data: { accountId: account.id, ...formData } })
                setShowAnnotationForm(false)
              }
              router.invalidate()
            }}
            onCancel={() => {
              setShowAnnotationForm(false)
              setEditingAnnotation(null)
            }}
          />
        )}

        {annotations.data.length === 0 && !showAnnotationForm ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">No annotations yet. Add one to mark events on the chart.</p>
        ) : (
          <div className="mt-2 space-y-2">
            {annotations.data.map((annotation) => (
              <div
                key={annotation.id}
                className="flex items-center justify-between py-2 border-b border-gray-100 dark:border-gray-800 last:border-0"
              >
                <div className="flex items-center gap-3 text-sm">
                  <span className="inline-block w-3 border-t border-dashed border-amber-400 dark:border-amber-500" />
                  <span className="font-medium text-gray-900 dark:text-gray-100">{annotation.label}</span>
                  <span className="text-gray-500 dark:text-gray-400">
                    {new Date(annotation.date).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </span>
                  {annotation.recurrence ? (
                    <span className="text-xs px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-300">
                      {annotation.recurrence.frequency}
                    </span>
                  ) : (
                    <span className="text-xs px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400">
                      one-time
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setEditingAnnotation(annotation)}
                    className="text-xs text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300"
                  >
                    Edit
                  </button>
                  <button
                    onClick={async () => {
                      await deleteAnnotation({ data: { id: annotation.id } })
                      router.invalidate()
                    }}
                    className="text-xs text-red-400 dark:text-red-500 hover:text-red-600 dark:hover:text-red-400"
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Section B: Instruments Carousel */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Instruments</h2>
          <Link
            to="/accounts/$accountId/instruments"
            params={{ accountId: account.id }}
            className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
          >
            View all
          </Link>
        </div>

        {sortedInstruments.length === 0 ? (
          <p className="text-gray-500 dark:text-gray-400 text-sm">No instruments yet.</p>
        ) : (
          <div className="flex gap-4 overflow-x-auto pb-2 -mx-2 px-2">
            {sortedInstruments.map((instrument) => {
              const balance = instrument.balance;
              const amountMinor = BigInt(balance ?? '0');
              const neg = amountMinor < 0
              const abs = neg ? -amountMinor : amountMinor
              const isDefault = instrument.id === account.defaultInstrumentId

              return (
                <InstrumentCard
                  key={instrument.id}
                  instrument={instrument}
                  account={account}
                  balance={amountMinor}
                  isDefault={isDefault}
                  rate={rates[instrument.id]?.rate ?? 1}
                  homeCurrencyCode={user!.homeCurrencyCode}
                />
              )
            })}
          </div>
        )}
      </section>

      {/* Section C: Recent Files */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Recent Files</h2>
          <div className="flex items-center gap-3">
            <Link
              to="/accounts/$accountId/files"
              params={{ accountId: account.id }}
              className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
            >
              View all
            </Link>
            {!showImportWizard && !showBulkImportWizard && (
              <>
                <button
                  onClick={() => setShowBulkImportWizard(true)}
                  className="px-3 py-1.5 text-sm font-medium text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 border border-gray-200 dark:border-gray-700 rounded-md transition-colors"
                >
                  Bulk import
                </button>
                <button
                  onClick={() => setShowImportWizard(true)}
                  className="px-3 py-1.5 text-sm font-medium bg-blue-600 hover:bg-blue-700 text-white rounded-md transition-colors"
                >
                  + Import CSV
                </button>
              </>
            )}
          </div>
        </div>

        {showImportWizard && (
          <div className="mb-6">
            <ImportWizard
              accountId={account!.id}
              accountName={account!.name}
              onClose={() => setShowImportWizard(false)}
              onSuccess={() => {
                setShowImportWizard(false)
                router.invalidate()
              }}
            />
          </div>
        )}

        {showBulkImportWizard && (
          <div className="mb-6">
            <BulkImportWizard
              accountId={account!.id}
              accountName={account!.name}
              onClose={() => setShowBulkImportWizard(false)}
              onSuccess={() => router.invalidate()}
            />
          </div>
        )}

        <PaginatedTable
          data={recentAccountfiles.data}
          columns={filesColumns}
          pagination={recentAccountfiles.pagination}
          onPaginationChange={() => {}}
          hidePagination
          onRowClick={(row) =>
            navigate({
              to: '/accounts/$accountId/files/$fileId',
              params: { accountId: account.id, fileId: row.id },
            })
          }
          getRowId={(row) => row.id}
        >
          <p>No files yet.</p>
        </PaginatedTable>
      </section>

      {/* Section D: Recent Events */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Recent Events</h2>
          <Link
            to="/accounts/$accountId/events"
            params={{ accountId }}
            className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
          >
            View all
          </Link>
        </div>

        <EventPreviewTable
          hideColumns={["account"]} // hide account filter since we are already scoped to an account
          events={recentAccountEvents.data}
          onRowClick={(event) => navigate({ search: (prev) => ({ ...prev, viewEvent: event.id }) })}
        />
      </section>
    </div>
  )
}

// ─── AnnotationForm ───────────────────────────────────────────────────────────

const RECURRENCE_OPTIONS = [
  { value: '', label: 'One-time' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'yearly', label: 'Yearly' },
] as const

function AnnotationForm({
  accountId,
  annotation,
  onSave,
  onCancel,
}: {
  accountId: string
  annotation: TimelineAnnotation | null
  onSave: (data: { label: string; date: string; recurrence: RecurrenceRule | null }) => Promise<void>
  onCancel: () => void
}) {
  const [submitting, setSubmitting] = React.useState(false)

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    const label = String(fd.get('label')).trim()
    const date = String(fd.get('date'))
    const recurrenceFreq = String(fd.get('recurrence'))
    const recurrence: RecurrenceRule | null = recurrenceFreq
      ? ({ frequency: recurrenceFreq } as RecurrenceRule)
      : null
    setSubmitting(true)
    try {
      await onSave({ label, date, recurrence })
    } finally {
      setSubmitting(false)
    }
  }

  const defaultDate = annotation
    ? new Date(annotation.date).toISOString().slice(0, 10)
    : new Date().toISOString().slice(0, 10)

  const defaultRecurrence = annotation?.recurrence?.frequency ?? ''

  return (
    <form onSubmit={handleSubmit} className="mb-4 p-4 bg-gray-50 dark:bg-gray-800 rounded-lg space-y-3">
      <div>
        <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Label</label>
        <input
          name="label"
          defaultValue={annotation?.label ?? ''}
          required
          placeholder="e.g. Salary raise"
          className="w-full px-3 py-1.5 text-sm border border-gray-200 dark:border-gray-700 rounded-md bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Date</label>
        <input
          name="date"
          type="date"
          defaultValue={defaultDate}
          required
          className="w-full px-3 py-1.5 text-sm border border-gray-200 dark:border-gray-700 rounded-md bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Recurrence</label>
        <select
          name="recurrence"
          defaultValue={defaultRecurrence}
          className="w-full px-3 py-1.5 text-sm border border-gray-200 dark:border-gray-700 rounded-md bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          {RECURRENCE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={submitting}
          className="px-3 py-1.5 text-sm font-medium bg-blue-600 hover:bg-blue-700 text-white rounded-md disabled:opacity-50"
        >
          {annotation ? 'Save' : 'Add'}
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
