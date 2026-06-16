import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { magicLink } from 'better-auth/plugins'
import { tanstackStartCookies } from 'better-auth/tanstack-start'
import { db } from '~/db'
import { users, sessions, authAccounts, verifications } from '~/db/schema'
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
    // Persists Better Auth cookies set from within TanStack Start server
    // functions / server routes.
    tanstackStartCookies(),
  ],

  databaseHooks: {
    user: {
      create: {
        // Magic-link sign-up may not include a name; the `name` column is NOT
        // NULL, so fall back to the email's local part.
        before: async (user) => {
          const name = (user.name ?? '').trim() || user.email.split('@')[0]
          return { data: { ...user, name } }
        },
        // The app expects every user to have a personal workspace.
        after: async (user) => {
          await ensurePersonalWorkspace({ id: user.id, name: user.name, email: user.email })
        },
      },
    },
  },
})
