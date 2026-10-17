import { sql } from 'drizzle-orm';
import type { Executor } from '@finance/db';
import { recordAssignments } from './assignments';
import { lockWorkspace } from './lock';
import type { LegRef } from './categorise';

export interface CategorySuggestion extends LegRef {
  categoryId: string;
}

/**
 * Category suggestions (feature 14) for the uncategorised legs of the given transactions: the
 * category most recently assigned to a leg with the same leg key whose transaction has the same
 * description key. Derived on read and never stored. Line items and internal principal legs get none.
 */
export async function suggestCategories(tx: Executor, workspaceId: string, transactionIds: string[]): Promise<CategorySuggestion[]> {
  if (transactionIds.length === 0) return [];
  const rows = await tx.execute<{ transaction_id: string; leg_key: string; category_id: string }>(sql`
    select l.transaction_id, l.leg_key, s.category_id
    from event_legs l
    join events e on e.id = l.event_id
    join transactions t on t.id = l.transaction_id
    join lateral (
      select sl.category_id
      from transactions st
      join event_legs sl on sl.transaction_id = st.id and sl.leg_key = l.leg_key and sl.category_id is not null
      join leg_assignments d on d.transaction_id = sl.transaction_id and d.leg_key = sl.leg_key and d.kind = 'category'
      where st.workspace_id = t.workspace_id and st.description_key = t.description_key
      order by d.seq desc
      limit 1
    ) s on true
    where l.workspace_id = ${workspaceId}
      and l.transaction_id in (${sql.join(
        transactionIds.map((id) => sql`${id}`),
        sql`, `,
      )})
      and l.category_id is null
      and l.leg_key not like 'line:%'
      and (not e.is_internal or l.role = 'fee')
      and t.description_key <> ''
  `);
  return [...rows].map((r) => ({ transactionId: r.transaction_id, legKey: r.leg_key, categoryId: r.category_id }));
}

/**
 * Accepts the current suggestions for the given legs, recording an ordinary category assignment for
 * each. Suggestions are recomputed here, so a leg whose suggestion changed or vanished is skipped.
 */
export async function acceptSuggestions(tx: Executor, workspaceId: string, legs: LegRef[], userId: string) {
  await lockWorkspace(tx, workspaceId);
  const wanted = new Set(legs.map((l) => `${l.transactionId}:${l.legKey}`));
  const suggestions = (await suggestCategories(tx, workspaceId, [...new Set(legs.map((l) => l.transactionId))])).filter((s) =>
    wanted.has(`${s.transactionId}:${s.legKey}`),
  );
  if (suggestions.length === 0) return { categorised: 0 };
  await recordAssignments(
    tx,
    workspaceId,
    suggestions.map((s) => ({
      workspaceId,
      transactionId: s.transactionId,
      kind: 'category' as const,
      legKey: s.legKey,
      payload: { categoryId: s.categoryId },
      userId,
    })),
  );
  return { categorised: suggestions.length };
}
