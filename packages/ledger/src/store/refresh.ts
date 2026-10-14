import type { Executor } from '@finance/db';
import { lockWorkspace } from './lock';
import { rebuildEvents } from './rebuild';
import { autoMatchTransfers } from './transfers';

/** Runs automatic reconciliation (transfer matching), then rebuilds the event projection. */
export async function refreshProjection(tx: Executor, workspaceId: string) {
  await lockWorkspace(tx, workspaceId);
  const matched = await autoMatchTransfers(tx, workspaceId);
  const { events } = await rebuildEvents(tx, workspaceId);
  return { matched, events };
}
