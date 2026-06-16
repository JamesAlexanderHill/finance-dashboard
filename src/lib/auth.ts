import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { magicLink } from 'better-auth/plugins'
import { passkey } from '@better-auth/passkey'
import { tanstackStartCookies } from 'better-auth/tanstack-start'
import { db } from '~/db'
import { users, sessions, authAccounts, verifications, passkeys } from '~/db/schema'
// Imported from the concrete module (not the `~/db/services` barrel) to avoid a
// circular import: the services barrel pulls in session.ts, which imports this
// file.
import { ensurePersonalWorkspace } from '~/db/services/service/workspace'

export const auth = betterAuth({
  // Falls back to BETTER_AUTH_URL / BETTER_AUTH_SECRET env vars when undefined.
  baseURL: process.env.BETTER_AUTH_URL,
  secret: process.env.BETTER_AUTH_SECRET,

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

  // Sign-in is via magic link only.
  emailAndPassword: { enabled: false },

  plugins: [
    magicLink({
      sendMagicLink: async ({ email, url }) => {
        // No transactional email provider is configured. Log the link to the
        // server console so it can be opened during development. Swap this for a
        // real email send (Resend, SES, Postmark, …) in production.
        console.log(`\n🔗 Magic link for ${email}:\n   ${url}\n`)
      },
    }),
    // WebAuthn passkeys. rpID is the host (no port/scheme); origin is the full
    // app URL. In production set PASSKEY_RP_ID / BETTER_AUTH_URL accordingly.
    passkey({
      rpID: process.env.PASSKEY_RP_ID ?? 'localhost',
      rpName: 'Finance Dashboard',
      origin: process.env.BETTER_AUTH_URL ?? 'http://localhost:3000',
    }),
    // Persists Better Auth cookies set from within TanStack Start server
    // functions / server routes.
    tanstackStartCookies(),
  ],

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
          await ensurePersonalWorkspace({ id: user.id, name: user.name, email: user.email })
        },
      },
    },
  },
})
