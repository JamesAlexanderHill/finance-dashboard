import { describe, expect, test, beforeEach } from 'bun:test'
import { desc, eq, inArray, like, sql } from 'drizzle-orm'
import { auth } from '~/lib/auth'
import { db } from '~/db'
import { users, workspaces, workspaceMembers, verifications, sessions } from '~/db/schema'
import { ensurePersonalWorkspace } from '~/db/services'

/**
 * In-process integration tests for the Better Auth setup. They drive the real
 * `auth` instance through its HTTP handler (the same entrypoint the API route
 * uses) against a real Postgres, so they exercise the full server-side flow:
 * magic-link sign-up/sign-in, session resolution, personal-workspace
 * provisioning, sign-out, and the passkey plugin wiring.
 *
 * Requires DATABASE_URL to point at a database with the schema pushed
 * (`bun db:push`). Skipped automatically when DATABASE_URL is unset.
 */

const BASE = 'http://localhost:3000'
const ORIGIN = { Origin: BASE }
const TEST_DOMAIN = '@authtest.example'

const hasDb = !!process.env.DATABASE_URL
const suite = hasDb ? describe : describe.skip

function call(path: string, init?: RequestInit) {
  return auth.handler(new Request(BASE + path, init))
}

async function requestMagicLink(email: string) {
  const res = await call('/api/auth/sign-in/magic-link', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...ORIGIN },
    body: JSON.stringify({ email, callbackURL: '/' }),
  })
  return res
}

/** Reads the most recent magic-link token for an email straight from the DB. */
async function latestMagicToken(email: string): Promise<string> {
  // Match the email exactly via the JSON `value`, with the time-ordered uuidv7
  // id as a tiebreaker so rapid repeat sign-ins return the newest token.
  const [row] = await db
    .select({ identifier: verifications.identifier })
    .from(verifications)
    .where(sql`${verifications.value}::jsonb->>'email' = ${email}`)
    .orderBy(desc(verifications.createdAt), desc(verifications.id))
    .limit(1)
  if (!row) throw new Error(`no verification token found for ${email}`)
  return row.identifier
}

function sessionCookie(res: Response): string {
  const setCookie = res.headers.get('set-cookie') ?? ''
  const match = setCookie.match(/better-auth\.session_token=([^;]+)/)
  if (!match) throw new Error('no session cookie in response')
  return `better-auth.session_token=${match[1]}`
}

/** Completes a full magic-link sign-in and returns the session cookie header. */
async function signInWithMagicLink(email: string): Promise<string> {
  await requestMagicLink(email)
  const token = await latestMagicToken(email)
  const res = await call(`/api/auth/magic-link/verify?token=${token}&callbackURL=/`)
  expect(res.status).toBe(302)
  return sessionCookie(res)
}

async function getSession(cookie: string) {
  const res = await call('/api/auth/get-session', { headers: { Cookie: cookie } })
  return res.json() as Promise<{ user: { id: string; email: string; name: string } } | null>
}

async function cleanupTestData() {
  const testUsers = await db
    .select({ id: users.id })
    .from(users)
    .where(like(users.email, `%${TEST_DOMAIN}`))
  const ids = testUsers.map((u) => u.id)
  if (ids.length) {
    await db.delete(workspaceMembers).where(inArray(workspaceMembers.userId, ids))
    await db.delete(workspaces).where(inArray(workspaces.ownerId, ids))
  }
  await db.delete(verifications).where(like(verifications.value, `%${TEST_DOMAIN}%`))
  if (ids.length) {
    // sessions / passkeys / auth_accounts cascade on user delete.
    await db.delete(users).where(inArray(users.id, ids))
  }
}

suite('Better Auth — magic link', () => {
  beforeEach(async () => {
    await cleanupTestData()
  })

  test('unauthenticated get-session returns null', async () => {
    const res = await call('/api/auth/get-session')
    expect(res.status).toBe(200)
    expect(await res.json()).toBeNull()
  })

  test('magic-link sign-in creates a user, personal workspace, and session', async () => {
    const email = `alice${TEST_DOMAIN}`
    const cookie = await signInWithMagicLink(email)

    // Session resolves to the new user.
    const session = await getSession(cookie)
    expect(session?.user.email).toBe(email)
    // Name defaults to the email local-part (set by the create hook).
    expect(session?.user.name).toBe('alice')

    // User row exists and is email-verified.
    const [user] = await db.select().from(users).where(eq(users.email, email))
    expect(user).toBeDefined()
    expect(user.emailVerified).toBe(true)

    // A personal workspace + owner membership were auto-provisioned.
    const [ws] = await db.select().from(workspaces).where(eq(workspaces.ownerId, user.id))
    expect(ws.isPersonal).toBe(true)
    const [member] = await db
      .select()
      .from(workspaceMembers)
      .where(eq(workspaceMembers.userId, user.id))
    expect(member.role).toBe('owner')
  })

  test('signing in again with the same email reuses the user and workspace', async () => {
    const email = `bob${TEST_DOMAIN}`
    const cookie1 = await signInWithMagicLink(email)
    const first = await getSession(cookie1)

    const cookie2 = await signInWithMagicLink(email)
    const second = await getSession(cookie2)

    expect(second?.user.id).toBe(first!.user.id)

    // Still exactly one user and one personal workspace.
    const userRows = await db.select().from(users).where(eq(users.email, email))
    expect(userRows).toHaveLength(1)
    const wsRows = await db.select().from(workspaces).where(eq(workspaces.ownerId, userRows[0].id))
    expect(wsRows).toHaveLength(1)
  })

  test('sign-out invalidates the session', async () => {
    const email = `carol${TEST_DOMAIN}`
    const cookie = await signInWithMagicLink(email)
    expect((await getSession(cookie))?.user.email).toBe(email)

    const out = await call('/api/auth/sign-out', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie, ...ORIGIN },
      body: '{}',
    })
    expect(out.status).toBe(200)
    expect(await getSession(cookie)).toBeNull()

    // The session row is gone.
    const [user] = await db.select().from(users).where(eq(users.email, email))
    const remaining = await db.select().from(sessions).where(eq(sessions.userId, user.id))
    expect(remaining).toHaveLength(0)
  })

  test('an invalid magic-link token does not create a session', async () => {
    const before = await db.select().from(sessions)
    const res = await call('/api/auth/magic-link/verify?token=not-a-real-token&callbackURL=/')
    // No session cookie is issued...
    expect(res.headers.get('set-cookie') ?? '').not.toContain('better-auth.session_token=')
    // ...and no session row is created.
    const after = await db.select().from(sessions)
    expect(after.length).toBe(before.length)
  })
})

suite('Better Auth — passkey plugin', () => {
  beforeEach(async () => {
    await cleanupTestData()
  })

  test('register options require an authenticated session', async () => {
    const res = await call('/api/auth/passkey/generate-register-options', {
      headers: { ...ORIGIN },
    })
    expect(res.status).toBe(401)
  })

  test('an authenticated user can request passkey registration options', async () => {
    const cookie = await signInWithMagicLink(`dave${TEST_DOMAIN}`)
    const res = await call('/api/auth/passkey/generate-register-options', {
      headers: { Cookie: cookie, ...ORIGIN },
    })
    expect(res.status).toBe(200)
    const options = (await res.json()) as { challenge?: string; rp?: { id?: string } }
    // WebAuthn registration options include a challenge and the configured RP.
    expect(typeof options.challenge).toBe('string')
    expect(options.rp?.id).toBe('localhost')
  })
})

suite('ensurePersonalWorkspace', () => {
  beforeEach(async () => {
    await cleanupTestData()
  })

  test('is idempotent — creates exactly one workspace + membership', async () => {
    const [user] = await db
      .insert(users)
      .values({ name: 'Eve', email: `eve${TEST_DOMAIN}` })
      .returning()

    const first = await ensurePersonalWorkspace(user)
    const second = await ensurePersonalWorkspace(user)
    expect(second.id).toBe(first.id)

    const wsRows = await db.select().from(workspaces).where(eq(workspaces.ownerId, user.id))
    expect(wsRows).toHaveLength(1)
    expect(wsRows[0].isPersonal).toBe(true)

    const members = await db
      .select()
      .from(workspaceMembers)
      .where(eq(workspaceMembers.workspaceId, first.id))
    expect(members).toHaveLength(1)
    expect(members[0].role).toBe('owner')
  })
})
