import * as React from 'react'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { db } from '~/db'
import { users } from '~/db/schema'
import { checkpointService, createContext } from '~/db/services'
import { clearAllData, seedBase, seedSampleEvents } from '~/lib/seed'

// ─── Server functions ─────────────────────────────────────────────────────────

const devClearAll = createServerFn({ method: 'POST' }).handler(async () => {
  await clearAllData()
  return { ok: true }
})

const devSeedBase = createServerFn({ method: 'POST' }).handler(async () => {
  const [existingUser] = await db.select().from(users).limit(1)
  if (existingUser) return { ok: false, message: 'User already exists. Clear data first.' }
  const result = await seedBase()
  return { ok: true, userId: result.userId }
})

const devSeedSampleEvents = createServerFn({ method: 'POST' }).handler(async () => {
  const [user] = await db.select().from(users).limit(1)
  if (!user) return { ok: false, message: 'No user found. Seed base data first.' }

  // Build seed result from existing data
  const { accounts, instruments, categories } = await import('~/db/schema')
  const { eq } = await import('drizzle-orm')
  const [accs, instrs, cats] = await Promise.all([
    db.select().from(accounts).where(eq(accounts.userId, user.id)),
    db.select().from(instruments).where(eq(instruments.userId, user.id)),
    db.select().from(categories).where(eq(categories.userId, user.id)),
  ])

  // Map to the keys used by seedSampleEvents (matching seedBase's SeedResult shape)
  const commbank = accs.find((a) => a.name === 'CommBank')
  const amex = accs.find((a) => a.name === 'AMEX')
  const wise = accs.find((a) => a.name === 'Wise')
  const vanguard = accs.find((a) => a.name === 'Vanguard')

  if (!commbank || !amex || !wise || !vanguard) {
    return { ok: false, message: 'Expected accounts not found. Run "Seed Base" first.' }
  }

  const commbankAud = instrs.find((i) => i.accountId === commbank.id && i.ticker === 'AUD')
  const amexAud = instrs.find((i) => i.accountId === amex.id && i.ticker === 'AUD')
  const wiseAud = instrs.find((i) => i.accountId === wise.id && i.ticker === 'AUD')
  const wiseNzd = instrs.find((i) => i.accountId === wise.id && i.ticker === 'NZD')
  const vanguardAud = instrs.find((i) => i.accountId === vanguard.id && i.ticker === 'AUD')
  const vanguardVhy = instrs.find((i) => i.accountId === vanguard.id && i.ticker === 'VHY')

  if (!commbankAud || !amexAud || !wiseAud || !wiseNzd || !vanguardAud || !vanguardVhy) {
    return { ok: false, message: 'Expected instruments not found. Run "Seed Base" first.' }
  }

  const groceries = cats.find((c) => c.name === 'Groceries')

  const mappedSeedResult = {
    userId: user.id,
    accountIds: { commbank: commbank.id, amex: amex.id, wise: wise.id, vanguard: vanguard.id },
    instrumentIds: {
      commbankAud: commbankAud.id,
      amexAud: amexAud.id,
      wiseAud: wiseAud.id,
      wiseNzd: wiseNzd.id,
      vanguardAud: vanguardAud.id,
      vanguardVhy: vanguardVhy.id,
    },
    categoryIds: { groceries: groceries?.id ?? '' },
  }

  await seedSampleEvents(mappedSeedResult)
  return { ok: true }
})

const getDevStatus = createServerFn({ method: 'GET' }).handler(async () => {
  const { count } = await import('drizzle-orm')
  const { events, legs, accounts: accountsTable, instrumentCheckpoints } = await import('~/db/schema')

  const [user] = await db.select().from(users).limit(1)
  if (!user) return { hasUser: false, eventCount: 0, legCount: 0, accountCount: 0, checkpointCount: 0 }

  const { eq } = await import('drizzle-orm')
  const [evtResult, legResult, accResult, checkpointResult] = await Promise.all([
    db.select({ n: count() }).from(events).where(eq(events.userId, user.id)),
    db.select({ n: count() }).from(legs).where(eq(legs.userId, user.id)),
    db.select({ n: count() }).from(accountsTable).where(eq(accountsTable.userId, user.id)),
    db.select({ n: count() }).from(instrumentCheckpoints).where(eq(instrumentCheckpoints.userId, user.id)),
  ])

  return {
    hasUser: true,
    userId: user.id,
    userName: user.name,
    eventCount: Number(evtResult[0]?.n ?? 0),
    legCount: Number(legResult[0]?.n ?? 0),
    accountCount: Number(accResult[0]?.n ?? 0),
    checkpointCount: Number(checkpointResult[0]?.n ?? 0),
  }
})

const devRecomputeCheckpoints = createServerFn({ method: 'POST' }).handler(async () => {
  const [user] = await db.select().from(users).limit(1)
  if (!user) return { ok: false, message: 'No user found. Seed base data first.' }

  const count = await checkpointService.refreshAll(createContext(user.id))
  return { ok: true, message: `Recomputed checkpoints for ${count} instrument(s).` }
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
        setMessage('Done!')
      } else {
        setState('error')
        setMessage(result.message ?? 'Failed')
      }
    } catch (err) {
      setState('error')
      setMessage(String(err))
    }
    // Reset after 3s
    setTimeout(() => setState('idle'), 3000)
  }

  return { state, message, run }
}

function DevPage() {
  const status = Route.useLoaderData()
  const router = useRouter()

  const clearAction = useAction(async () => {
    const r = await devClearAll()
    router.invalidate()
    return r
  })

  const seedBaseAction = useAction(async () => {
    const r = await devSeedBase()
    router.invalidate()
    return r as any
  })

  const seedEventsAction = useAction(async () => {
    const r = await devSeedSampleEvents()
    router.invalidate()
    return r as any
  })

  const recomputeCheckpointsAction = useAction(async () => {
    const r = await devRecomputeCheckpoints()
    router.invalidate()
    return r
  })

  const actions = [
    {
      label: 'Clear all data',
      description: 'Delete all users, accounts, events, legs, etc.',
      action: clearAction,
      danger: true,
    },
    {
      label: 'Seed base',
      description: 'Create demo user, 5 accounts, instruments, 8 categories, 2 views.',
      action: seedBaseAction,
    },
    {
      label: 'Seed sample events',
      description: 'Add purchase, transfer pair, exchange, and VDAL trade (requires base seed).',
      action: seedEventsAction,
    },
    {
      label: 'Recompute checkpoints',
      description: 'Rebuild monthly balance checkpoints for every instrument.',
      action: recomputeCheckpointsAction,
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
          <p className="text-xs text-gray-400 dark:text-gray-500 mb-1">User</p>
          {status.hasUser ? (
            <>
              <p className="font-medium text-gray-900 dark:text-gray-100">{status.userName}</p>
              <p className="text-xs text-gray-400 dark:text-gray-500 font-mono mt-0.5 truncate">
                {status.userId}
              </p>
            </>
          ) : (
            <p className="text-gray-400 dark:text-gray-500 italic">No user seeded</p>
          )}
        </div>
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4">
          <p className="text-xs text-gray-400 dark:text-gray-500 mb-1">Data counts</p>
          <div className="flex gap-4">
            <Stat label="Accounts" value={status.accountCount} />
            <Stat label="Events" value={status.eventCount} />
            <Stat label="Legs" value={status.legCount} />
            <Stat label="Checkpoints" value={status.checkpointCount} />
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
