import * as React from 'react'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { Button } from '~/components/ui/button'
import { authClient } from '~/lib/auth-client'
import { fetchAuthUser } from '~/lib/auth-guard'

export const Route = createFileRoute('/login')({
  beforeLoad: async () => {
    // Already signed in — skip the login page.
    const user = await fetchAuthUser()
    if (user) throw redirect({ to: '/' })
  },
  component: LoginPage,
})

function LoginPage() {
  const [status, setStatus] = React.useState<'idle' | 'sending' | 'sent' | 'error'>('idle')
  const [email, setEmail] = React.useState('')
  const [error, setError] = React.useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setStatus('sending')
    setError(null)

    const { error } = await authClient.signIn.magicLink({
      email: email.trim(),
      callbackURL: '/',
    })

    if (error) {
      setError(error.message ?? 'Something went wrong. Please try again.')
      setStatus('error')
      return
    }

    setStatus('sent')
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">Finance</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Sign in with a magic link sent to your email.
          </p>
        </div>

        {status === 'sent' ? (
          <div className="rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 text-sm text-gray-700 dark:text-gray-300">
            <p className="font-medium text-gray-900 dark:text-gray-100">Check your email</p>
            <p className="mt-1">
              We sent a sign-in link to <span className="font-medium">{email}</span>. Click it to continue.
            </p>
            <p className="mt-2 text-xs text-gray-400">
              No email provider is configured in development — the link is also printed in the server console.
            </p>
            <button
              type="button"
              className="mt-3 text-xs text-blue-600 dark:text-blue-400 underline"
              onClick={() => setStatus('idle')}
            >
              Use a different email
            </button>
          </div>
        ) : (
          <form
            onSubmit={handleSubmit}
            className="rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 space-y-3"
          >
            <div className="space-y-1">
              <label htmlFor="email" className="text-sm font-medium text-gray-700 dark:text-gray-300">
                Email
              </label>
              <input
                id="email"
                name="email"
                type="email"
                required
                autoFocus
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-950 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 outline-none focus-visible:border-blue-500 focus-visible:ring-2 focus-visible:ring-blue-500/30"
              />
            </div>

            {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

            <Button type="submit" size="lg" className="w-full" disabled={status === 'sending'}>
              {status === 'sending' ? 'Sending…' : 'Send magic link'}
            </Button>
          </form>
        )}
      </div>
    </div>
  )
}
