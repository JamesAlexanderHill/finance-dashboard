import { eq } from 'drizzle-orm';
import { categories, getDb, workspaceMembers, workspaces } from '@finance/db';
import { FIXED_CATEGORIES } from '@finance/domain';

/** Creates the user's default workspace, owner membership and fixed top-level categories. Idempotent. */
export async function provisionWorkspace(userId: string, name: string) {
  const db = getDb();
  return db.transaction(async (tx) => {
    const [existing] = await tx.select().from(workspaceMembers).where(eq(workspaceMembers.userId, userId));
    if (existing) return existing.workspaceId;
    const [ws] = await tx.insert(workspaces).values({ name: `${name}'s finances` }).returning();
    await tx.insert(workspaceMembers).values({ workspaceId: ws!.id, userId, role: 'owner' });
    await tx.insert(categories).values(FIXED_CATEGORIES.map((c) => ({ workspaceId: ws!.id, name: c.name, kind: c.kind, sortOrder: c.sortOrder, isFixed: true })));
    return ws!.id;
  });
}

/** The workspace a user owns. v1 has exactly one per user; the client never chooses it. */
export async function workspaceForUser(userId: string): Promise<string | null> {
  const [m] = await getDb().select({ workspaceId: workspaceMembers.workspaceId }).from(workspaceMembers).where(eq(workspaceMembers.userId, userId));
  return m?.workspaceId ?? null;
}
