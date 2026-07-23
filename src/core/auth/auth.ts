import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { magicLink, genericOAuth } from 'better-auth/plugins'
import { passkey } from '@better-auth/passkey'
import { tanstackStartCookies } from 'better-auth/tanstack-start'
import { db } from '~/core/database'
import { users, sessions, authAccounts, verifications, passkeys } from '~/core/database/schema'
import { getSsoProviders, isMagicLinkEnabled, isPasskeyEnabled } from '~/core/config'
import { logger } from '~/core/logging'
// Imported from the concrete module (not `~/core/workspaces`'s public index) to
// avoid a circular import: that index re-exports session resolution, which
// imports this file.
import { ensureDefaultWorkspace } from '~/core/workspaces/service'

// Read directly (with fallbacks) rather than through `~/core/config`'s strict
// `getEnv()` — this module must stay importable (e.g. by tests) even when the
// full environment isn't configured; `getEnv()` is for the real server boot
// path (see `~/core/config/env.ts`).
const baseURL = process.env.BETTER_AUTH_URL
const secret = process.env.BETTER_AUTH_SECRET
const passkeyRpId = process.env.PASSKEY_RP_ID ?? 'localhost'

// Each sign-in method below is independently env-driven (`AUTH_MAGIC_LINK_ENABLED`,
// `AUTH_PASSKEY_ENABLED`, `AUTH_SSO_PROVIDERS_JSON` — see `~/core/config`), so an
// application built on this scaffold enables only the methods it needs.
const plugins = [
  ...(isMagicLinkEnabled()
    ? [
        magicLink({
          sendMagicLink: async ({ email, url }) => {
            // No transactional email provider is configured. Log the link so
            // it can be opened during development. Swap this for a real
            // email send (Resend, SES, Postmark, …) in production.
            logger.info('Magic link generated', { email, url })
          },
        }),
      ]
    : []),
  // WebAuthn passkeys. rpID is the host (no port/scheme); origin is the full
  // app URL. In production set PASSKEY_RP_ID / BETTER_AUTH_URL accordingly.
  ...(isPasskeyEnabled()
    ? [
        passkey({
          rpID: passkeyRpId,
          rpName: 'Finance Dashboard',
          origin: baseURL ?? 'http://localhost:3000',
        }),
      ]
    : []),
  // Single sign-on via any number of externally-hosted identity providers,
  // configured entirely from `AUTH_SSO_PROVIDERS_JSON` — empty/unset disables
  // SSO without touching this file.
  ...(getSsoProviders().length > 0 ? [genericOAuth({ config: getSsoProviders() })] : []),
  // Persists Better Auth cookies set from within TanStack Start server
  // functions / server routes.
  tanstackStartCookies(),
]

export const auth = betterAuth({
  // Falls back to the BETTER_AUTH_URL / BETTER_AUTH_SECRET env vars when undefined.
  baseURL,
  secret,

  // Reuse the app's existing Drizzle + Postgres connection. Better Auth's models
  // are mapped onto our tables; `account` -> `auth_accounts` avoids colliding
  // with the app's financial `accounts` table.
  database: drizzleAdapter(db, {
    provider: 'pg',
    schema: {
      user: users,
      session: sessions,
      account: authAccounts,
      verification: verifications,
      passkey: passkeys,
    },
  }),

  // There are no passwords — sign-in is via magic link, passkey, and/or SSO.
  emailAndPassword: { enabled: false },

  plugins,

  databaseHooks: {
    user: {
      create: {
        // Normalize the email (lower-case) so it matches the app's email
        // lookups, and default a name (the NOT NULL `name` column) from the
        // email local-part when magic-link sign-up doesn't provide one.
        before: async (user) => {
          const email = user.email.trim().toLowerCase()
          const name = (user.name ?? '').trim() || email.split('@')[0]
          return { data: { ...user, email, name } }
        },
        // The app expects every user to have a personal workspace.
        after: async (user) => {
          await ensureDefaultWorkspace({ id: user.id, name: user.name, email: user.email })
        },
      },
    },
  },
})
