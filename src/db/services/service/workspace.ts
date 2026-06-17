import { eq, and } from 'drizzle-orm'
import { db } from '~/db'
import { users, workspaces, workspaceMembers } from '~/db/schema'
import type { RequestContext } from '../utils/context'
import {
  queryWorkspacesByUser,
  queryWorkspaceMembership,
  queryWorkspaceMembers,
  queryUserByEmail,
  queryFirstWorkspace,
} from '../query/workspace'

async function list(ctx: RequestContext) {
  return queryWorkspacesByUser(ctx.userId)
}

async function getCurrent(ctx: RequestContext) {
  return queryWorkspaceMembership(ctx.workspaceId, ctx.userId)
}

async function requireMembership(ctx: RequestContext) {
  const membership = await queryWorkspaceMembership(ctx.workspaceId, ctx.userId)
  if (!membership) throw new Error('Not a member of this workspace')
  return membership
}

async function create(ctx: RequestContext, data: { name: string }) {
  const name = data.name.trim()
  if (!name) throw new Error('Workspace name is required')

  return db.transaction(async (tx) => {
    const [workspace] = await tx
      .insert(workspaces)
      .values({ name, ownerId: ctx.userId })
      .returning()

    await tx.insert(workspaceMembers).values({
      workspaceId: workspace.id,
      userId: ctx.userId,
      role: 'owner',
    })

    return workspace
  })
}

async function update(ctx: RequestContext, data: { name?: string }) {
  const membership = await requireMembership(ctx)
  if (membership.role !== 'owner') throw new Error('Only the workspace owner can update settings')

  const name = data.name?.trim()
  if (!name) return membership.workspace

  const [updated] = await db.update(workspaces).set({ name }).where(eq(workspaces.id, ctx.workspaceId)).returning()
  return updated
}

async function listMembers(ctx: RequestContext) {
  await requireMembership(ctx)
  return queryWorkspaceMembers(ctx.workspaceId)
}

/** Add an existing user to the workspace by email. Owner-only; the invitee must already have an account. */
async function addMember(ctx: RequestContext, email: string) {
  const membership = await requireMembership(ctx)
  if (membership.role !== 'owner') throw new Error('Only the workspace owner can add members')

  const user = await queryUserByEmail(email)
  if (!user) throw new Error(`No user found with email ${email}`)

  const existing = await queryWorkspaceMembership(ctx.workspaceId, user.id)
  if (existing) throw new Error(`${user.name} is already a member of this workspace`)

  await db.insert(workspaceMembers).values({ workspaceId: ctx.workspaceId, userId: user.id, role: 'member' })
  return user
}

async function removeMember(ctx: RequestContext, userId: string) {
  const membership = await requireMembership(ctx)
  const { workspace } = membership

  if (userId === workspace.ownerId) throw new Error('Cannot remove the workspace owner')
  if (membership.role !== 'owner' && userId !== ctx.userId) {
    throw new Error('Only the workspace owner can remove other members')
  }

  await db
    .delete(workspaceMembers)
    .where(and(eq(workspaceMembers.workspaceId, ctx.workspaceId), eq(workspaceMembers.userId, userId)))
}

/** Create a new user along with their default workspace. */
export async function createUserWithPersonalWorkspace(data: {
  name: string
  email: string
  homeCurrencyCode: string
}) {
  const name = data.name.trim()
  const email = data.email.trim().toLowerCase()
  if (!name) throw new Error('Name is required')
  if (!email) throw new Error('Email is required')

  const existing = await queryUserByEmail(email)
  if (existing) throw new Error(`A user with email ${email} already exists`)

  return db.transaction(async (tx) => {
    const [user] = await tx
      .insert(users)
      .values({ name, email, homeCurrencyCode: data.homeCurrencyCode.trim().toUpperCase() })
      .returning()

    const [workspace] = await tx
      .insert(workspaces)
      .values({ name: `${name}'s Workspace`, ownerId: user.id })
      .returning()

    await tx.insert(workspaceMembers).values({ workspaceId: workspace.id, userId: user.id, role: 'owner' })

    return { user, workspace }
  })
}

/**
 * Ensure a user has at least one workspace, creating one (plus the owner
 * membership) if they have none. Idempotent — used by the Better Auth
 * `user.create` hook, where the user row already exists.
 */
export async function ensureDefaultWorkspace(user: { id: string; name: string; email: string }) {
  const existing = await queryFirstWorkspace(user.id)
  if (existing) return existing

  const name = user.name?.trim() || user.email.split('@')[0]

  return db.transaction(async (tx) => {
    const [workspace] = await tx
      .insert(workspaces)
      .values({ name: `${name}'s Workspace`, ownerId: user.id })
      .returning()

    await tx.insert(workspaceMembers).values({ workspaceId: workspace.id, userId: user.id, role: 'owner' })

    return workspace
  })
}

export const workspaceService = { list, getCurrent, create, update, listMembers, addMember, removeMember }
