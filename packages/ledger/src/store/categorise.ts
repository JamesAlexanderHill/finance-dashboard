import { and, eq, inArray, isNull, not, or } from 'drizzle-orm';
import { categories, eventLegs, events, type Executor } from '@finance/db';
import { recordDecisions } from './decisions';
import { lockWorkspace } from './lock';

export class CategoriseError extends Error {}

export interface LegRef {
  transactionId: string;
  legKey: string;
}

/**
 * Gives many legs one category in a single step (feature 14). This is still manual: each leg gets its own
 * category decision, exactly as if it were categorised alone, and nothing applies to future imports.
 * Legs that cannot carry a category (internal principal legs), are not in the current projection, or
 * already have the category are skipped. Returns how many legs changed.
 */
export async function categoriseLegs(tx: Executor, workspaceId: string, legs: LegRef[], categoryId: string | null, userId: string) {
  await lockWorkspace(tx, workspaceId);
  if (categoryId) {
    const [c] = await tx
      .select({ id: categories.id })
      .from(categories)
      .where(and(eq(categories.id, categoryId), eq(categories.workspaceId, workspaceId)));
    if (!c) throw new CategoriseError('Category not found');
  }
  if (legs.length === 0) return { categorised: 0 };

  const wanted = new Set(legs.map((l) => `${l.transactionId}:${l.legKey}`));
  const current = await tx
    .select({ transactionId: eventLegs.transactionId, legKey: eventLegs.legKey, categoryId: eventLegs.categoryId })
    .from(eventLegs)
    .innerJoin(events, eq(events.id, eventLegs.eventId))
    .where(
      and(
        eq(eventLegs.workspaceId, workspaceId),
        inArray(eventLegs.transactionId, [...new Set(legs.map((l) => l.transactionId))]),
        or(not(events.isInternal), eq(eventLegs.role, 'fee')),
        categoryId ? or(isNull(eventLegs.categoryId), not(eq(eventLegs.categoryId, categoryId))) : not(isNull(eventLegs.categoryId)),
      ),
    );
  const changes = current.filter((l) => wanted.has(`${l.transactionId}:${l.legKey}`));
  if (changes.length === 0) return { categorised: 0 };

  await recordDecisions(
    tx,
    workspaceId,
    changes.map((l) => ({
      workspaceId,
      transactionId: l.transactionId!,
      kind: 'category' as const,
      legKey: l.legKey,
      payload: { categoryId },
      userId,
    })),
  );
  return { categorised: changes.length };
}
