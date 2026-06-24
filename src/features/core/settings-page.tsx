import * as React from 'react'
import { useRouter } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { createServerFn } from '@tanstack/react-start'
import { eq } from 'drizzle-orm'
import { KeyRound, Trash2 } from 'lucide-react'
import { db } from '~/db'
import { passkeys as passkeysTable } from '~/db/schema'
import { getSession } from '~/db/services'
import { Button } from '~/components/ui/button'
import { authClient } from '~/lib/auth-client'

// ─── Server functions ─────────────────────────────────────────────────────────

const getAccountData = createServerFn({ method: 'GET' }).handler(async () => {
  const session = await getSession()
  if (!session) return null
  const { user } = session

  const userPasskeys = await db
    .select({
      id: passkeysTable.id,
      name: passkeysTable.name,
      deviceType: passkeysTable.deviceType,
      createdAt: passkeysTable.createdAt,
    })
    .from(passkeysTable)
    .where(eq(passkeysTable.userId, user.id))
    .orderBy(passkeysTable.createdAt)

  return {
    name: user.name,
    email: user.email,
    emailVerified: user.emailVerified,
    createdAt: user.createdAt,
    passkeys: userPasskeys,
  }
})

// ─── Loader ───────────────────────────────────────────────────────────────────

export const settingsLoader = () => getAccountData()

export type SettingsPageData = Awaited<ReturnType<typeof getAccountData>>

// ─── Component ────────────────────────────────────────────────────────────────

export function SettingsPage({ account }: { account: SettingsPageData }) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const [name, setName] = React.useState(account?.name ?? '')
  const [saving, setSaving] = React.useState(false)
  const [saved, setSaved] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  if (!account) {
    return <div className="text-sm text-gray-500 dark:text-gray-400">Not signed in.</div>
  }

  async function handleSave(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setSaving(true)
    setSaved(false)
    setError(null)

    const { error } = await authClient.updateUser({ name: name.trim() })

    setSaving(false)
    if (error) {
      setError(error.message ?? 'Could not save changes.')
      return
    }
    setSaved(true)
    router.invalidate()
  }

  async function handleSignOut() {
    await authClient.signOut()
    queryClient.clear()
    router.navigate({ to: '/login' })
  }

  return (
    <div className="max-w-xl space-y-6">
      <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">Account settings</h1>

      <section className="rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Profile</h2>
        <form onSubmit={handleSave} className="mt-3 space-y-3">
          <div className="space-y-1">
            <label htmlFor="name" className="text-sm font-medium text-gray-700 dark:text-gray-300">
              Name
            </label>
            <input
              id="name"
              name="name"
              type="text"
              required
              value={name}
              onChange={(e) => {
                setName(e.target.value)
                setSaved(false)
              }}
              className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-950 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 outline-none focus-visible:border-blue-500 focus-visible:ring-2 focus-visible:ring-blue-500/30"
            />
          </div>

          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

          <div className="flex items-center gap-3">
            <Button type="submit" disabled={saving || name.trim() === account.name}>
              {saving ? 'Saving…' : 'Save changes'}
            </Button>
            {saved && <span className="text-sm text-green-600 dark:text-green-400">Saved</span>}
          </div>
        </form>
      </section>

      <PasskeysSection passkeys={account.passkeys} />

      <section className="rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 space-y-3">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Account</h2>
        <dl className="text-sm">
          <div className="flex justify-between py-1.5 border-b border-gray-100 dark:border-gray-800">
            <dt className="text-gray-500 dark:text-gray-400">Email</dt>
            <dd className="text-gray-900 dark:text-gray-100">{account.email}</dd>
          </div>
          <div className="flex justify-between py-1.5 border-b border-gray-100 dark:border-gray-800">
            <dt className="text-gray-500 dark:text-gray-400">Email verified</dt>
            <dd className="text-gray-900 dark:text-gray-100">{account.emailVerified ? 'Yes' : 'No'}</dd>
          </div>
          <div className="flex justify-between py-1.5">
            <dt className="text-gray-500 dark:text-gray-400">Member since</dt>
            <dd className="text-gray-900 dark:text-gray-100">
              {new Date(account.createdAt).toLocaleDateString()}
            </dd>
          </div>
        </dl>
      </section>

      <section className="rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Sign out</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">End your session on this device.</p>
        </div>
        <Button variant="outline" onClick={handleSignOut}>
          Logout
        </Button>
      </section>
    </div>
  )
}

// ─── Passkeys section ─────────────────────────────────────────────────────────

type PasskeyRow = { id: string; name: string | null; deviceType: string; createdAt: Date }

function PasskeysSection({ passkeys }: { passkeys: PasskeyRow[] }) {
  const router = useRouter()
  const [name, setName] = React.useState('')
  const [pending, setPending] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  async function handleAdd(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setPending(true)
    const res = await authClient.passkey.addPasskey({ name: name.trim() || undefined })
    setPending(false)

    if (res?.error) {
      setError(res.error.message ?? 'Could not register passkey.')
      return
    }
    setName('')
    router.invalidate()
  }

  async function handleDelete(id: string) {
    setError(null)
    const res = await authClient.passkey.deletePasskey({ id })
    if (res?.error) {
      setError(res.error.message ?? 'Could not remove passkey.')
      return
    }
    router.invalidate()
  }

  return (
    <section className="rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 space-y-3">
      <div>
        <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Passkeys</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Sign in without an email using your device's biometrics or security key.
        </p>
      </div>

      {passkeys.length > 0 ? (
        <ul className="divide-y divide-gray-100 dark:divide-gray-800">
          {passkeys.map((pk) => (
            <li key={pk.id} className="flex items-center justify-between py-2">
              <span className="flex items-center gap-2 text-sm text-gray-900 dark:text-gray-100">
                <KeyRound className="size-4 text-gray-400" />
                {pk.name || 'Passkey'}
                <span className="text-xs text-gray-400">
                  · {pk.deviceType} · {new Date(pk.createdAt).toLocaleDateString()}
                </span>
              </span>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Remove passkey"
                onClick={() => handleDelete(pk.id)}
              >
                <Trash2 className="size-4 text-red-500" />
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-gray-400">No passkeys registered yet.</p>
      )}

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      <form onSubmit={handleAdd} className="flex items-end gap-2 pt-1">
        <div className="flex-1 space-y-1">
          <label htmlFor="passkey-name" className="text-xs font-medium text-gray-500 dark:text-gray-400">
            Name (optional)
          </label>
          <input
            id="passkey-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. MacBook Touch ID"
            className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-950 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 outline-none focus-visible:border-blue-500 focus-visible:ring-2 focus-visible:ring-blue-500/30"
          />
        </div>
        <Button type="submit" variant="outline" disabled={pending}>
          <KeyRound className="size-4" />
          {pending ? 'Waiting…' : 'Add passkey'}
        </Button>
      </form>
    </section>
  )
}
