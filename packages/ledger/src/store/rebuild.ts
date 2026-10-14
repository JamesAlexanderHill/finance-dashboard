import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import {
  categories,
  eventLegs,
  events,
  eventTransactionLinks,
  financialAccounts,
  reconciliationDecisions,
  transactions,
  type Executor,
} from '@finance/db';
import { projectEvents, type DecisionRecord } from '../index';
import { lockWorkspace } from './lock';

const CHUNK = 1000;

async function insertChunked<T>(rows: T[], insert: (chunk: T[]) => Promise<unknown>) {
  for (let i = 0; i < rows.length; i += CHUNK) await insert(rows.slice(i, i + CHUNK));
}

/**
 * Drops and regenerates the workspace's events and legs (they are a pure projection).
 * Must run inside a DB transaction so readers never see a half-built projection.
 */
export async function rebuildEvents(tx: Executor, workspaceId: string) {
  await lockWorkspace(tx, workspaceId);

  const [active, decisions, cats, openings] = await Promise.all([
    tx
      .select({
        id: transactions.id,
        accountId: transactions.accountId,
        postedOn: transactions.postedOn,
        description: transactions.description,
        amount: transactions.amount,
        commodity: transactions.commodity,
      })
      .from(transactions)
      .where(and(eq(transactions.workspaceId, workspaceId), eq(transactions.isSourceSupported, true), eq(transactions.isSuppressed, false)))
      .orderBy(asc(transactions.postedOn), asc(transactions.id)),
    tx
      .select({
        id: reconciliationDecisions.id,
        seq: reconciliationDecisions.seq,
        transactionId: reconciliationDecisions.transactionId,
        kind: reconciliationDecisions.kind,
        legKey: reconciliationDecisions.legKey,
        payload: reconciliationDecisions.payload,
      })
      .from(reconciliationDecisions)
      .where(eq(reconciliationDecisions.workspaceId, workspaceId)),
    tx
      .select({ id: categories.id, kind: categories.kind })
      .from(categories)
      .where(and(eq(categories.workspaceId, workspaceId), isNull(categories.archivedAt))),
    // Earliest opening balance per account from a live statement, preferring statements over manual entry.
    tx.execute<{ account_id: string; observed_on: string; balance: string; commodity: string }>(sql`
      select distinct on (bo.account_id) bo.account_id, bo.observed_on::text, bo.balance::text, fa.commodity
      from balance_observations bo
      join ${financialAccounts} fa on fa.id = bo.account_id
      left join source_files sf on sf.id = bo.source_file_id
      where bo.workspace_id = ${workspaceId} and bo.kind = 'opening'
        and (bo.source_file_id is null or sf.deleted_at is null)
      order by bo.account_id, (bo.source = 'statement') desc, bo.observed_on asc
    `),
  ]);

  const projected = projectEvents({
    transactions: active,
    decisions: decisions as DecisionRecord[],
    categories: cats,
    openingBalances: [...openings].map((o) => ({ accountId: o.account_id, on: o.observed_on, balance: o.balance, commodity: o.commodity })),
  });

  await tx.delete(events).where(eq(events.workspaceId, workspaceId));
  await insertChunked(projected, (chunk) =>
    tx.insert(events).values(
      chunk.map((e) => ({
        id: e.id,
        workspaceId,
        type: e.type,
        occurredOn: e.occurredOn,
        description: e.description,
        isInternal: e.isInternal,
        governingDecisionId: e.governingDecisionId,
      })),
    ),
  );
  await insertChunked(
    projected.flatMap((e) => e.legs),
    (chunk) => tx.insert(eventLegs).values(chunk.map((l) => ({ ...l, workspaceId }))),
  );
  await insertChunked(
    projected.flatMap((e) => e.transactionIds.map((transactionId) => ({ eventId: e.id, transactionId }))),
    (chunk) => tx.insert(eventTransactionLinks).values(chunk),
  );
  return { events: projected.length };
}
