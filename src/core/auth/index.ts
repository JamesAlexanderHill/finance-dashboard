/**
 * Public contract of the auth capability. `auth` (the server-side Better Auth
 * instance) is intentionally NOT re-exported here — it pulls in Node/Postgres
 * dependencies that must never reach the client bundle. Server code that needs
 * it imports `~/core/auth/auth` directly (see `~/core/session/session.ts`).
 */
export { authClient } from './auth-client'
export { fetchAuthUser } from './auth-guard'
