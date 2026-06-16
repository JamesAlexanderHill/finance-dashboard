import * as React from 'react'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { eq, count } from 'drizzle-orm'
import { db } from '~/db'
import {
  users,
  workspaces,
  accounts,
  events,
  legs,
  instrumentCheckpoints,
  instrumentRates,
} from '~/db/schema'
import { checkpointService, rateService, createUserWithPersonalWorkspace, getSession } from '~/db/services'
import { clearAllData, seedBase, seedSampleEvents } from '~/lib/seed'

// ─── Server functions ─────────────────────────────────────────────────────────

// Dev tools mutate/wipe data, so guard them behind an authenticated session —
// the server functions are callable directly, not just from the (gated) page.
async function requireDevSession() {
  const session = await getSession()
  if (!session) throw new Error('Unauthorized')
  return session
}

const devClearAll = createServerFn({ method: 'POST' }).handler(async () => {
  await requireDevSession()
  await clearAllData()
  return { ok: true }
})

const devSeedBase = createServerFn({ method: 'POST' }).handler(async () => {
  await requireDevSession()
  const [existingUser] = await db.select().from(users).limit(1)
  if (existingUser) return { ok: false, message: 'Users already exist. Clear data first.' }
  await seedBase()
  return { ok: true, message: 'Created Demo User A, Demo User B, and shared workspace "Joint Finances".' }
})

const devSeedSampleEvents = createServerFn({ method: 'POST' }).handler(async () => {
  await requireDevSession()
  const [sharedWorkspace] = await db
    .select()
    .from(workspaces)
    .where(eq(workspaces.isPersonal, false))
    .limit(1)
  if (!sharedWorkspace) return { ok: false, message: 'No shared workspace found. Run "Seed Base" first.' }

  const [{ n: eventCount }] = await db.select({ n: count() }).from(events).where(eq(events.workspaceId, sharedWorkspace.id))
  if (Number(eventCount) > 0) return { ok: false, message: 'Events already exist. Clear data and re-seed.' }

  await seedSampleEvents(sharedWorkspace.id)
  return { ok: true }
})

const getDevStatus = createServerFn({ method: 'GET' }).handler(async () => {
  const session = await getSession()
  if (!session) return { hasUser: false, eventCount: 0, legCount: 0, accountCount: 0, checkpointCount: 0, rateCount: 0 }

  const { user, workspace } = session
  const [evtResult, legResult, accResult, checkpointResult, rateResult] = await Promise.all([
    db.select({ n: count() }).from(events).where(eq(events.workspaceId, workspace.id)),
    db.select({ n: count() }).from(legs).where(eq(legs.workspaceId, workspace.id)),
    db.select({ n: count() }).from(accounts).where(eq(accounts.workspaceId, workspace.id)),
    db.select({ n: count() }).from(instrumentCheckpoints).where(eq(instrumentCheckpoints.workspaceId, workspace.id)),
    db.select({ n: count() }).from(instrumentRates).where(eq(instrumentRates.workspaceId, workspace.id)),
  ])

  return {
    hasUser: true,
    userId: user.id,
    userName: user.name,
    workspaceName: workspace.name,
    eventCount: Number(evtResult[0]?.n ?? 0),
    legCount: Number(legResult[0]?.n ?? 0),
    accountCount: Number(accResult[0]?.n ?? 0),
    checkpointCount: Number(checkpointResult[0]?.n ?? 0),
    rateCount: Number(rateResult[0]?.n ?? 0),
  }
})

const devRecomputeCheckpoints = createServerFn({ method: 'POST' }).handler(async () => {
  const session = await getSession()
  if (!session) return { ok: false, message: 'No user found. Seed base data first.' }

  const result = await checkpointService.refreshAll(session.ctx)
  return { ok: true, message: `Recomputed checkpoints for ${result} instrument(s).` }
})

const devRecomputeRates = createServerFn({ method: 'POST' }).handler(async () => {
  const session = await getSession()
  if (!session) return { ok: false, message: 'No user found. Seed base data first.' }

  const result = await rateService.refreshAll(session.ctx)
  return { ok: true, message: `Recomputed rates for ${result} instrument(s).` }
})

const devCreateAdditionalUser = createServerFn({ method: 'POST' })
  .inputValidator((data: unknown) => data as { name: string; email: string; homeCurrencyCode: string })
  .handler(async ({ data }) => {
    await requireDevSession()
    try {
      const { user, workspace } = await createUserWithPersonalWorkspace({
        name: data.name,
        email: data.email,
        homeCurrencyCode: data.homeCurrencyCode,
      })
      return { ok: true, message: `Created ${user.name} <${user.email}> with workspace "${workspace.name}".` }
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) }
    }
  })

// ─── Route ────────────────────────────────────────────────────────────────────

export const Route = createFileRoute('/dev')({
  loader: () => getDevStatus(),
  component: DevPage,
})

// ─── Component ────────────────────────────────────────────────────────────────

type ActionState = 'idle' | 'loading' | 'success' | 'error'

function useAction(fn: () => Promise<{ ok: boolean; message?: string }>) {
  const [state, setState] = React.useState<ActionState>('idle')
  const [message, setMessage] = React.useState('')

  async function run() {
    setState('loading')
    setMessage('')
    try {
      const result = await fn()
      if (result.ok) {
        setState('success')
        setMessage(result.message || 'Done!')
      } else {
        setState('error')
        setMessage(result.message ?? 'Failed')
      }
    } catch (err) {
      setState('error')
      setMessage(String(err))
    }
    setTimeout(() => setState('idle'), 3000)
  }

  return { state, message, run }
}

function DevPage() {
  const status = Route.useLoaderData()
  const router = useRouter()

  const [newUserName, setNewUserName] = React.useState('')
  const [newUserEmail, setNewUserEmail] = React.useState('')
  const [newUserCurrency, setNewUserCurrency] = React.useState('AUD')

  const clearAction = useAction(async () => {
    const r = await devClearAll()
    router.invalidate()
    return r
  })

  const seedBaseAction = useAction(async () => {
    const r = await devSeedBase()
    router.invalidate()
    return r
  })

  const seedEventsAction = useAction(async () => {
    const r = await devSeedSampleEvents()
    router.invalidate()
    return r
  })

  const recomputeCheckpointsAction = useAction(async () => {
    const r = await devRecomputeCheckpoints()
    router.invalidate()
    return r
  })

  const recomputeRatesAction = useAction(async () => {
    const r = await devRecomputeRates()
    router.invalidate()
    return r
  })

  const createUserAction = useAction(async () => {
    const r = await devCreateAdditionalUser({
      data: { name: newUserName, email: newUserEmail, homeCurrencyCode: newUserCurrency },
    })
    if (r.ok) {
      setNewUserName('')
      setNewUserEmail('')
      setNewUserCurrency('AUD')
    }
    router.invalidate()
    return r
  })

  const actions = [
    {
      label: 'Clear all data',
      description: 'Delete everything — users, workspaces, accounts, events, legs, files, checkpoints — in dependency order.',
      action: clearAction,
      danger: true,
    },
    {
      label: 'Seed base',
      description: 'Create Demo User A & B, each with a personal workspace, plus a shared "Joint Finances" workspace (A as owner, B as member).',
      action: seedBaseAction,
    },
    {
      label: 'Seed sample events',
      description: 'Create 4 accounts (CommBank, AMEX, Wise, Vanguard), 7 instruments, 12 categories, and ~30 events spanning Aug 2025–May 2026. Covers all 6 event types, legs with categories & descriptions, lineItems, 3 transfer pairs, and a simulated import file.',
      action: seedEventsAction,
    },
    {
      label: 'Recompute checkpoints',
      description: 'Rebuild monthly balance checkpoints for every instrument.',
      action: recomputeCheckpointsAction,
    },
    {
      label: 'Recompute rates',
      description: 'Rebuild transaction-derived currency rates for every instrument (manual rates are preserved).',
      action: recomputeRatesAction,
    },
  ]

  return (
    <div className="max-w-2xl">
      {/* Warning banner */}
      <div className="mb-6 flex items-start gap-3 p-4 bg-yellow-50 dark:bg-yellow-950 border border-yellow-200 dark:border-yellow-800 rounded-xl">
        <span className="text-yellow-600 dark:text-yellow-400 text-lg">⚠</span>
        <div>
          <p className="text-sm font-semibold text-yellow-800 dark:text-yellow-300">
            Dev tools only
          </p>
          <p className="text-xs text-yellow-700 dark:text-yellow-400 mt-0.5">
            This page is only visible in development mode. All actions are destructive or
            irreversible and should not be used in production.
          </p>
        </div>
      </div>

      <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100 mb-6">Dev Tools</h1>

      {/* Status */}
      <div className="mb-6 grid grid-cols-2 gap-3 text-sm">
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4">
          <p className="text-xs text-gray-400 dark:text-gray-500 mb-1">User / Workspace</p>
          {status.hasUser ? (
            <>
              <p className="font-medium text-gray-900 dark:text-gray-100">{status.userName}</p>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{status.workspaceName}</p>
              <p className="text-xs text-gray-400 dark:text-gray-500 font-mono mt-0.5 truncate">
                {status.userId}
              </p>
            </>
          ) : (
            <p className="text-gray-400 dark:text-gray-500 italic">No user seeded</p>
          )}
        </div>
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4">
          <p className="text-xs text-gray-400 dark:text-gray-500 mb-1">Data counts (current workspace)</p>
          <div className="flex gap-4">
            <Stat label="Accounts" value={status.accountCount} />
            <Stat label="Events" value={status.eventCount} />
            <Stat label="Legs" value={status.legCount} />
            <Stat label="Checkpoints" value={status.checkpointCount} />
            <Stat label="Rates" value={status.rateCount} />
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="space-y-3">
        {actions.map(({ label, description, action, danger }) => (
          <div
            key={label}
            className="flex items-center justify-between gap-4 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4"
          >
            <div className="flex-1">
              <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{label}</p>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{description}</p>
              {action.message && (
                <p
                  className={[
                    'text-xs mt-1',
                    action.state === 'success'
                      ? 'text-green-600 dark:text-green-400'
                      : 'text-red-600 dark:text-red-400',
                  ].join(' ')}
                >
                  {action.message}
                </p>
              )}
            </div>
            <button
              onClick={action.run}
              disabled={action.state === 'loading'}
              className={[
                'px-4 py-2 text-sm font-medium rounded-md transition-colors disabled:opacity-50 whitespace-nowrap',
                danger
                  ? 'bg-red-600 hover:bg-red-700 text-white'
                  : 'bg-gray-800 dark:bg-gray-100 hover:bg-gray-700 dark:hover:bg-gray-200 text-white dark:text-gray-900',
              ].join(' ')}
            >
              {action.state === 'loading' ? 'Working…' : action.state === 'success' ? '✓ Done' : label}
            </button>
          </div>
        ))}

        {/* Create additional user */}
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4">
          <p className="text-sm font-medium text-gray-900 dark:text-gray-100">Create additional user</p>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 mb-3">
            Create a new user with their own personal workspace. Use this to test scenarios beyond the two demo users seeded by "Seed Base".
          </p>
          <div className="flex flex-wrap gap-2">
            <input
              type="text"
              value={newUserName}
              onChange={(e) => setNewUserName(e.target.value)}
              placeholder="Name"
              className="flex-1 min-w-[120px] text-sm border border-gray-200 dark:border-gray-700 rounded-md px-3 py-1.5 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <input
              type="email"
              value={newUserEmail}
              onChange={(e) => setNewUserEmail(e.target.value)}
              placeholder="Email"
              className="flex-1 min-w-[160px] text-sm border border-gray-200 dark:border-gray-700 rounded-md px-3 py-1.5 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <input
              type="text"
              value={newUserCurrency}
              onChange={(e) => setNewUserCurrency(e.target.value.toUpperCase())}
              placeholder="AUD"
              maxLength={3}
              className="w-20 text-sm border border-gray-200 dark:border-gray-700 rounded-md px-3 py-1.5 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button
              onClick={createUserAction.run}
              disabled={createUserAction.state === 'loading' || !newUserName || !newUserEmail}
              className="px-4 py-1.5 text-sm font-medium rounded-md transition-colors disabled:opacity-50 whitespace-nowrap bg-gray-800 dark:bg-gray-100 hover:bg-gray-700 dark:hover:bg-gray-200 text-white dark:text-gray-900"
            >
              {createUserAction.state === 'loading' ? 'Working…' : 'Create user'}
            </button>
          </div>
          {createUserAction.message && (
            <p
              className={[
                'text-xs mt-2',
                createUserAction.state === 'success'
                  ? 'text-green-600 dark:text-green-400'
                  : 'text-red-600 dark:text-red-400',
              ].join(' ')}
            >
              {createUserAction.message}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: number | undefined }) {
  return (
    <div>
      <p className="text-lg font-bold text-gray-900 dark:text-gray-100 tabular-nums">
        {value ?? '—'}
      </p>
      <p className="text-xs text-gray-400 dark:text-gray-500">{label}</p>
    </div>
  )
}
