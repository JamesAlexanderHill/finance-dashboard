import { eq, and } from 'drizzle-orm'
import { db } from '~/db'
import { users, workspaces, workspaceMembers } from '~/db/schema'

export async function queryWorkspacesByUser(userId: string) {
  return db
    .select({
      id: workspaces.id,
      name: workspaces.name,
      ownerId: workspaces.ownerId,
      createdAt: workspaces.createdAt,
      role: workspaceMembers.role,
    })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaceMembers.workspaceId, workspaces.id))
    .where(eq(workspaceMembers.userId, userId))
    .orderBy(workspaces.name)
}

export async function queryWorkspaceMembership(workspaceId: string, userId: string) {
  const [row] = await db
    .select({ workspace: workspaces, role: workspaceMembers.role })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaceMembers.workspaceId, workspaces.id))
    .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)))

  return row ?? null
}

/** Returns the oldest workspace the user belongs to — used as a fallback when no workspace cookie is set. */
export async function queryFirstWorkspace(userId: string) {
  const [row] = await db
    .select({ workspace: workspaces })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaceMembers.workspaceId, workspaces.id))
    .where(eq(workspaceMembers.userId, userId))
    .orderBy(workspaceMembers.createdAt)
    .limit(1)

  return row?.workspace ?? null
}

export async function queryWorkspaceMembers(workspaceId: string) {
  return db
    .select({
      userId: users.id,
      name: users.name,
      email: users.email,
      role: workspaceMembers.role,
      createdAt: workspaceMembers.createdAt,
    })
    .from(workspaceMembers)
    .innerJoin(users, eq(workspaceMembers.userId, users.id))
    .where(eq(workspaceMembers.workspaceId, workspaceId))
    .orderBy(workspaceMembers.createdAt)
}

export async function queryUserByEmail(email: string) {
  const [row] = await db
    .select()
    .from(users)
    .where(eq(users.email, email.trim().toLowerCase()))

  return row ?? null
}

export async function queryUserById(userId: string) {
  const [row] = await db.select().from(users).where(eq(users.id, userId))
  return row ?? null
}
