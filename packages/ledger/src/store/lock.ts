import { sql } from 'drizzle-orm';
import type { Executor } from '@finance/db';

/** Serialises reconciliation work per workspace for the rest of the DB transaction. */
export async function lockWorkspace(tx: Executor, workspaceId: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'workspace:' + workspaceId}))`);
}
