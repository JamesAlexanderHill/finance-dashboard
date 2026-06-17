import { getCookie, setCookie, getRequest } from '@tanstack/react-start/server'
import { createServerOnlyFn } from '@tanstack/react-start'
import type { User, Workspace } from '~/db/schema'
import { createContext, type RequestContext } from './context'
import { queryUserById, queryWorkspaceMembership, queryFirstWorkspace } from '../query/workspace'

const WORKSPACE_COOKIE = 'fd_workspace_id'
const COOKIE_OPTS = { path: '/', sameSite: 'lax' as const, maxAge: 60 * 60 * 24 * 365 }

export type Session = {
  user: User
  workspace: Workspace
  ctx: RequestContext
}

/**
 * Resolves the authenticated user's id from the Better Auth session cookie.
 *
 * Wrapped in `createServerOnlyFn` and using a dynamic import so the Better Auth
 * instance (and its Node/Postgres dependencies) are never pulled into the client
 * bundle. Only ever called from within server functions / server routes.
 */
const getAuthUserId = createServerOnlyFn(async (): Promise<string | null> => {
  // Only `~/lib/auth` must be imported lazily — that's what keeps Better Auth
  // (and its Node/Postgres deps) out of the client bundle.
  const { auth } = await import('~/lib/auth')
  const session = await auth.api.getSession({ headers: getRequest().headers })
  return session?.user?.id ?? null
})

/** Resolves the currently authenticated user, or `null` if signed out. */
async function getCurrentUser(): Promise<User | null> {
  const userId = await getAuthUserId()
  if (!userId) return null
  return queryUserById(userId)
}

/**
 * Resolves the "current workspace" for a user from the `fd_workspace_id`
 * cookie, falling back to their personal workspace if unset or no longer
 * accessible to them.
 */
async function getCurrentWorkspace(userId: string): Promise<Workspace | null> {
  const cookieWorkspaceId = getCookie(WORKSPACE_COOKIE)
  if (cookieWorkspaceId) {
    const membership = await queryWorkspaceMembership(cookieWorkspaceId, userId)
    if (membership) return membership.workspace
  }

  return queryFirstWorkspace(userId)
}

/** Resolves the current user, workspace, and a `RequestContext` for service calls. Returns `null` if not authenticated. */
export async function getSession(): Promise<Session | null> {
  const user = await getCurrentUser()
  if (!user) return null

  const workspace = await getCurrentWorkspace(user.id)
  if (!workspace) return null

  return { user, workspace, ctx: createContext(user.id, workspace.id) }
}

/** Switch the current workspace. */
export function setCurrentWorkspaceId(workspaceId: string): void {
  setCookie(WORKSPACE_COOKIE, workspaceId, COOKIE_OPTS)
}
