import { getCookie, setCookie, deleteCookie } from '@tanstack/react-start/server'
import type { User, Workspace } from '~/db/schema'
import { createContext, type RequestContext } from './context'
import { queryUserById, queryAllUsers, queryWorkspaceMembership, queryPersonalWorkspace } from '../query/workspace'

const USER_COOKIE = 'fd_user_id'
const WORKSPACE_COOKIE = 'fd_workspace_id'
const COOKIE_OPTS = { path: '/', sameSite: 'lax' as const, maxAge: 60 * 60 * 24 * 365 }

export type Session = {
  user: User
  workspace: Workspace
  ctx: RequestContext
}

/**
 * Resolves the "logged in" user. There's no real authentication — the
 * current user is whichever id is in the `fd_user_id` cookie (set via the
 * dev-only user switcher), falling back to the first user in the database so
 * the app keeps working out of the box / in tests that never switch users.
 */
async function getCurrentUser(): Promise<User | null> {
  const cookieUserId = getCookie(USER_COOKIE)
  if (cookieUserId) {
    const user = await queryUserById(cookieUserId)
    if (user) return user
  }

  const [firstUser] = await queryAllUsers()
  return firstUser ?? null
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

  return queryPersonalWorkspace(userId)
}

/** Resolves the current user, workspace, and a `RequestContext` for service calls. Returns `null` if no user exists yet. */
export async function getSession(): Promise<Session | null> {
  const user = await getCurrentUser()
  if (!user) return null

  const workspace = await getCurrentWorkspace(user.id)
  if (!workspace) return null

  return { user, workspace, ctx: createContext(user.id, workspace.id) }
}

/** Switch the acting user (dev-only user switcher). Resets the workspace selection to the new user's personal workspace. */
export function setCurrentUserId(userId: string): void {
  setCookie(USER_COOKIE, userId, COOKIE_OPTS)
  deleteCookie(WORKSPACE_COOKIE, { path: '/' })
}

/** Switch the current workspace. */
export function setCurrentWorkspaceId(workspaceId: string): void {
  setCookie(WORKSPACE_COOKIE, workspaceId, COOKIE_OPTS)
}
