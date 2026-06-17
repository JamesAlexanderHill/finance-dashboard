import { Client } from 'pg'
import type { Page } from '@playwright/test'

const TEST_DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://dev:development@localhost:5332/db_test'

async function withDb<T>(fn: (c: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: TEST_DATABASE_URL })
  await client.connect()
  try {
    return await fn(client)
  } finally {
    await client.end()
  }
}

/** Reads the most recent magic-link token for an email straight from the DB. */
export function getMagicLinkToken(email: string): Promise<string> {
  return withDb(async (c) => {
    // Match the email exactly via the JSON `value` (not a substring LIKE), and
    // break createdAt ties with the time-ordered uuidv7 id.
    const res = await c.query(
      `SELECT identifier FROM verifications
         WHERE value::jsonb->>'email' = $1
         ORDER BY created_at DESC, id DESC LIMIT 1`,
      [email],
    )
    if (!res.rows[0]) throw new Error(`no magic link token found for ${email}`)
    return res.rows[0].identifier as string
  })
}

/** Id of the seeded shared ("Joint Finances") workspace that holds sample data. */
export function getSharedWorkspaceId(): Promise<string> {
  return withDb(async (c) => {
    const res = await c.query(
      `SELECT id FROM workspaces WHERE is_personal = false ORDER BY created_at LIMIT 1`,
    )
    if (!res.rows[0]) throw new Error('no shared workspace found — was the DB seeded?')
    return res.rows[0].id as string
  })
}

/** Removes a test user and everything that hangs off them (FK-safe order). */
export function deleteUser(email: string): Promise<void> {
  return withDb(async (c) => {
    await c.query(
      `DELETE FROM workspace_members WHERE workspace_id IN
         (SELECT id FROM workspaces WHERE owner_id IN (SELECT id FROM users WHERE email = $1))`,
      [email],
    )
    await c.query(
      `DELETE FROM workspace_members WHERE user_id IN (SELECT id FROM users WHERE email = $1)`,
      [email],
    )
    await c.query(`DELETE FROM workspaces WHERE owner_id IN (SELECT id FROM users WHERE email = $1)`, [email])
    await c.query(`DELETE FROM verifications WHERE value LIKE $1`, [`%${email}%`])
    await c.query(`DELETE FROM users WHERE email = $1`, [email]) // cascades sessions/passkeys/auth_accounts
  })
}

/** Drives the full magic-link sign-in through the real UI + verify endpoint. */
export async function loginWithMagicLink(page: Page, email: string): Promise<void> {
  // `networkidle` lets the SSR'd page hydrate before we interact — otherwise an
  // early click submits the form natively instead of via React.
  await page.goto('/login', { waitUntil: 'networkidle' })
  await page.getByLabel('Email').fill(email)
  await page.getByRole('button', { name: 'Send magic link' }).click()
  await page.getByText('Check your email').waitFor()

  const token = await getMagicLinkToken(email)
  await page.goto(`/api/auth/magic-link/verify?token=${encodeURIComponent(token)}&callbackURL=/`, {
    waitUntil: 'networkidle',
  })
  // Lands on the dashboard once the session cookie is set.
  await page.waitForURL((url) => !url.pathname.startsWith('/login'))
  await page.waitForLoadState('networkidle')
}

/**
 * Registers a CDP virtual WebAuthn authenticator so passkey register/sign-in
 * can run headlessly. Returns a disable() cleanup.
 */
export async function enableVirtualAuthenticator(page: Page) {
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('WebAuthn.enable')
  const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  })
  return {
    authenticatorId,
    disable: () => cdp.send('WebAuthn.removeVirtualAuthenticator', { authenticatorId }),
  }
}
