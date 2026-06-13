import { eq, and, desc } from 'drizzle-orm'
import { db } from '~/db'
import { users, workspaces, workspaceMembers } from '~/db/schema'

export async function queryWorkspacesByUser(userId: string) {
  return db
    .select({
      id: workspaces.id,
      name: workspaces.name,
      homeCurrencyCode: workspaces.homeCurrencyCode,
      isPersonal: workspaces.isPersonal,
      ownerId: workspaces.ownerId,
      createdAt: workspaces.createdAt,
      role: workspaceMembers.role,
    })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaceMembers.workspaceId, workspaces.id))
    .where(eq(workspaceMembers.userId, userId))
    .orderBy(desc(workspaces.isPersonal), workspaces.name)
}

export async function queryWorkspaceMembership(workspaceId: string, userId: string) {
  const [row] = await db
    .select({ workspace: workspaces, role: workspaceMembers.role })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaceMembers.workspaceId, workspaces.id))
    .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)))

  return row ?? null
}

export async function queryPersonalWorkspace(userId: string) {
  const [row] = await db
    .select()
    .from(workspaces)
    .where(and(eq(workspaces.ownerId, userId), eq(workspaces.isPersonal, true)))

  return row ?? null
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

export async function queryAllUsers() {
  return db.select().from(users).orderBy(users.name)
}
