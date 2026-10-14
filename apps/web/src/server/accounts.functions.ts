import { createServerFn } from '@tanstack/react-start';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { createManualAccountInput, idInput, mergeAccountInput, recordManualBalanceInput, updateAccountInput } from '@finance/contracts';
import { balanceObservations, financialAccounts, getDb, institutions } from '@finance/db';
import { mergeAccount, unmergeAccount } from '@finance/imports';
import { workspaceMiddleware } from './session';

export const listAccounts = createServerFn({ method: 'GET' })
  .middleware([workspaceMiddleware])
  .handler(async ({ context }) => {
    return getDb()
      .select({
        id: financialAccounts.id,
        name: financialAccounts.name,
        institutionId: financialAccounts.institutionId,
        institution: institutions.name,
        provider: institutions.provider,
        commodityKind: financialAccounts.commodityKind,
        accountType: financialAccounts.accountType,
        classification: financialAccounts.classification,
        commodity: financialAccounts.commodity,
        maskedIdentifier: financialAccounts.maskedIdentifier,
        status: financialAccounts.status,
        mergedIntoId: financialAccounts.mergedIntoId,
        // Latest observed balance from a live statement (its own or a merged account's); never inferred from partial history.
        balance: sql<{ on: string; balance: string } | null>`(
          select json_build_object('on', bo.observed_on, 'balance', bo.balance::text)
          from balance_observations bo join financial_accounts m on m.id = bo.account_id
          left join source_files sf on sf.id = bo.source_file_id
          where ${financialAccounts.id} in (m.id, m.merged_into_id) and (bo.source_file_id is null or sf.deleted_at is null)
          order by bo.observed_on desc, (bo.kind = 'closing') desc limit 1)`,
        activeTransactions: sql<number>`(select count(*)::int from transactions t where t.account_id = ${financialAccounts.id}
          and t.is_source_supported and not t.is_suppressed)`,
      })
      .from(financialAccounts)
      .innerJoin(institutions, eq(institutions.id, financialAccounts.institutionId))
      .where(eq(financialAccounts.workspaceId, context.workspaceId))
      .orderBy(asc(institutions.name), asc(financialAccounts.classification), asc(financialAccounts.name));
  });

export const updateAccount = createServerFn({ method: 'POST' })
  .middleware([workspaceMiddleware])
  .validator(updateAccountInput)
  .handler(async ({ context, data }) => {
    await getDb()
      .update(financialAccounts)
      .set({ ...(data.name ? { name: data.name } : {}), ...(data.confirm ? { status: 'confirmed' as const } : {}) })
      .where(and(eq(financialAccounts.id, data.id), eq(financialAccounts.workspaceId, context.workspaceId)));
  });

/** ADR 0011: an unconfirmed account found to be an existing one is merged into it; reversible. */
export const mergeAccounts = createServerFn({ method: 'POST' })
  .middleware([workspaceMiddleware])
  .validator(mergeAccountInput)
  .handler(async ({ context, data }) => {
    await mergeAccount(getDb(), context.workspaceId, data.id, data.intoId, context.userId);
  });

export const unmergeAccounts = createServerFn({ method: 'POST' })
  .middleware([workspaceMiddleware])
  .validator(idInput)
  .handler(async ({ context, data }) => {
    await unmergeAccount(getDb(), context.workspaceId, data.id);
  });

const MANUAL_PROVIDER = 'manual';

/** Creates an account under the workspace's Manual institution (feature 12), valued only by entered balances. */
export const createManualAccount = createServerFn({ method: 'POST' })
  .middleware([workspaceMiddleware])
  .validator(createManualAccountInput)
  .handler(async ({ context, data }) => {
    const db = getDb();
    const { workspaceId } = context;
    return db.transaction(async (tx) => {
      let [institution] = await tx
        .select()
        .from(institutions)
        .where(and(eq(institutions.workspaceId, workspaceId), eq(institutions.provider, MANUAL_PROVIDER)));
      institution ??= (await tx.insert(institutions).values({ workspaceId, name: 'Manual', provider: MANUAL_PROVIDER }).returning())[0]!;
      const [account] = await tx
        .insert(financialAccounts)
        .values({
          workspaceId,
          institutionId: institution.id,
          name: data.name,
          accountType: data.classification === 'liability' ? 'loan' : 'other',
          classification: data.classification,
          commodity: data.currency,
          identifier: `manual:${crypto.randomUUID()}`,
          maskedIdentifier: 'Manual',
          status: 'confirmed',
        })
        .returning({ id: financialAccounts.id });
      return account!;
    });
  });

async function manualAccount(workspaceId: string, accountId: string) {
  const [account] = await getDb()
    .select({ id: financialAccounts.id, classification: financialAccounts.classification })
    .from(financialAccounts)
    .innerJoin(institutions, eq(institutions.id, financialAccounts.institutionId))
    .where(
      and(eq(financialAccounts.id, accountId), eq(financialAccounts.workspaceId, workspaceId), eq(institutions.provider, MANUAL_PROVIDER)),
    );
  if (!account) throw new Error('Manual account not found');
  return account;
}

/** Records a dated value; revisions are new observations, so history is kept. Liabilities are stored negative. */
export const recordManualBalance = createServerFn({ method: 'POST' })
  .middleware([workspaceMiddleware])
  .validator(recordManualBalanceInput)
  .handler(async ({ context, data }) => {
    const account = await manualAccount(context.workspaceId, data.accountId);
    await getDb()
      .insert(balanceObservations)
      .values({
        workspaceId: context.workspaceId,
        accountId: account.id,
        observedOn: data.observedOn,
        kind: 'point',
        balance: account.classification === 'liability' ? `-${data.amount}` : data.amount,
        source: 'manual',
      });
  });

export const listManualBalances = createServerFn({ method: 'GET' })
  .middleware([workspaceMiddleware])
  .validator(idInput)
  .handler(async ({ context, data }) => {
    await manualAccount(context.workspaceId, data.id);
    const rows = await getDb()
      .select({
        id: balanceObservations.id,
        observedOn: balanceObservations.observedOn,
        balance: balanceObservations.balance,
        createdAt: balanceObservations.createdAt,
      })
      .from(balanceObservations)
      .where(eq(balanceObservations.accountId, data.id))
      .orderBy(desc(balanceObservations.observedOn), desc(balanceObservations.createdAt));
    return rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }));
  });
