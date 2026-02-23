import { createFileRoute, Link } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { eq, and } from 'drizzle-orm'
import { db } from '~/db'
import { users, importRuns, events, legs, instruments, accounts } from '~/db/schema'
import { formatAmount } from '~/lib/balance'

// ─── Server function ──────────────────────────────────────────────────────────

const getImportRunDetail = createServerFn({ method: 'GET' })
  .validator((data: unknown) => data as { id: string })
  .handler(async ({ data }) => {
    const [user] = await db.select().from(users).limit(1)
    if (!user) throw new Error('No user')

    const [run] = await db
      .select()
      .from(importRuns)
      .where(and(eq(importRuns.id, data.id), eq(importRuns.userId, user.id)))

    if (!run) throw new Error('Import run not found')

    const [account] = await db
      .select()
      .from(accounts)
      .where(eq(accounts.id, run.accountId))

    // Load events created by this run
    const importedEvents = await db.query.events.findMany({
      where: eq(events.importRunId, run.id),
      orderBy: (e, { asc }) => [asc(e.effectiveAt)],
      with: {
        legs: { with: { instrument: true } },
      },
    })

    return { run, account, importedEvents }
  })

// ─── Route ────────────────────────────────────────────────────────────────────

export const Route = createFileRoute('/imports/$id')({
  loader: ({ params }) => getImportRunDetail({ data: { id: params.id } }),
  component: ImportRunPage,
})

// ─── Component ────────────────────────────────────────────────────────────────

function ImportRunPage() {
  const { run, account, importedEvents } = Route.useLoaderData()

  const stats = [
    { label: 'Imported', value: run.importedCount, color: 'text-green-700 dark:text-green-400' },
    { label: 'Skipped', value: run.skippedCount, color: 'text-gray-600 dark:text-gray-400' },
    { label: 'Restored', value: run.restoredCount, color: 'text-blue-700 dark:text-blue-400' },
    {
      label: 'Errors',
      value: run.errorCount,
      color: run.errorCount > 0 ? 'text-red-600 dark:text-red-400' : 'text-gray-400 dark:text-gray-500',
    },
  ]

  return (
    <div className="max-w-3xl">
      <Link
        to="/imports"
        className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 mb-4 inline-block"
      >
        ← Imports
      </Link>

      <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100 mb-1">
        {run.filename}
      </h1>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
        {account?.name} ·{' '}
        {new Date(run.createdAt).toLocaleDateString('en-AU', {
          day: 'numeric',
          month: 'long',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        })}
      </p>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-3 mb-6">
        {stats.map((s) => (
          <div
            key={s.label}
            className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4 text-center"
          >
            <p className={`text-2xl font-bold tabular-nums ${s.color}`}>{s.value}</p>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Errors */}
      {run.errors.length > 0 && (
        <div className="mb-6 rounded-lg bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 p-4">
          <p className="text-sm font-semibold text-red-700 dark:text-red-300 mb-2">
            Errors ({run.errors.length})
          </p>
          <ul className="space-y-1">
            {run.errors.map((err, i) => (
              <li key={i} className="text-xs text-red-600 dark:text-red-400">
                [{err.phase}] Line {err.line}: {err.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Skipped keys */}
      {run.skippedKeys.length > 0 && (
        <div className="mb-6">
          <p className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
            Skipped ({run.skippedKeys.length})
          </p>
          <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3 max-h-40 overflow-y-auto">
            {run.skippedKeys.map((key, i) => (
              <p key={i} className="text-xs text-gray-500 dark:text-gray-400 font-mono">
                {key}
              </p>
            ))}
          </div>
        </div>
      )}

      {/* Imported events */}
      {importedEvents.length > 0 && (
        <div>
          <p className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
            Imported Events ({importedEvents.length})
          </p>
          <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50">
                  <th className="text-left px-4 py-2 font-medium text-gray-500 dark:text-gray-400">Date</th>
                  <th className="text-left px-4 py-2 font-medium text-gray-500 dark:text-gray-400">Description</th>
                  <th className="text-left px-4 py-2 font-medium text-gray-500 dark:text-gray-400">Legs</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {importedEvents.map((ev) => (
                  <tr key={ev.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                    <td className="px-4 py-2 text-gray-500 dark:text-gray-400 whitespace-nowrap text-xs">
                      {new Date(ev.effectiveAt).toLocaleDateString('en-AU')}
                    </td>
                    <td className="px-4 py-2">
                      <Link
                        to="/events/$id"
                        params={{ id: ev.id }}
                        className="text-blue-600 dark:text-blue-400 hover:underline"
                      >
                        {ev.description}
                      </Link>
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex flex-wrap gap-2">
                        {ev.legs.map((leg: any) => {
                          const neg = leg.amountMinor < BigInt(0)
                          const abs = neg ? -leg.amountMinor : leg.amountMinor
                          return (
                            <span
                              key={leg.id}
                              className={[
                                'text-xs tabular-nums',
                                neg ? 'text-red-600 dark:text-red-400' : 'text-green-700 dark:text-green-400',
                              ].join(' ')}
                            >
                              {neg ? '−' : '+'}
                              {formatAmount(abs, leg.instrument.minorUnit)} {leg.instrument.code}
                            </span>
                          )
                        })}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
