import { createServerFn } from '@tanstack/react-start';
import { and, asc, desc, eq, inArray, or, sql } from 'drizzle-orm';
import {
  closeAccountInput,
  createManualAccountInput,
  idInput,
  mergeAccountInput,
  pairAccountInput,
  recordManualBalanceInput,
  updateAccountInput,
} from '@finance/contracts';
import { balanceObservations, financialAccounts, getDb, institutions, sourceFiles, sourceRecords, statements } from '@finance/db';
import {
  closeAccount,
  latestAccountActivity,
  mergeAccount,
  pairAccount,
  reopenAccount,
  unmergeAccount,
  unpairAccount,
} from '@finance/imports';
import { equityAt } from '@finance/ledger';
import { add, addDays, endOfMonth, neg, todayIso, type IsoDate } from '@finance/shared';
import { workspaceMiddleware } from './session';
import { loadValuationInputs } from './valuation.server';

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
        closedOn: financialAccounts.closedOn,
        pairedAssetId: financialAccounts.pairedAssetId,
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

/**
 * One account with what it is built from: every balance observation (its own and those of accounts merged
 * into it), and the statements naming any of them. The current balance follows the same rule as
 * `listAccounts`: the latest observation from a live statement or entered by hand.
 */
export const getAccount = createServerFn({ method: 'GET' })
  .middleware([workspaceMiddleware])
  .validator(idInput)
  .handler(async ({ context, data }) => {
    const db = getDb();
    const accountColumns = {
      id: financialAccounts.id,
      name: financialAccounts.name,
      institution: institutions.name,
      provider: institutions.provider,
      accountType: financialAccounts.accountType,
      classification: financialAccounts.classification,
      commodityKind: financialAccounts.commodityKind,
      commodity: financialAccounts.commodity,
      instrumentId: financialAccounts.instrumentId,
      maskedIdentifier: financialAccounts.maskedIdentifier,
      status: financialAccounts.status,
      mergedIntoId: financialAccounts.mergedIntoId,
      closedOn: financialAccounts.closedOn,
      pairedAssetId: financialAccounts.pairedAssetId,
    };
    const related = await db
      .select(accountColumns)
      .from(financialAccounts)
      .innerJoin(institutions, eq(institutions.id, financialAccounts.institutionId))
      .where(
        and(
          eq(financialAccounts.workspaceId, context.workspaceId),
          or(eq(financialAccounts.id, data.id), eq(financialAccounts.mergedIntoId, data.id)),
        ),
      )
      .orderBy(asc(financialAccounts.name));
    const account = related.find((a) => a.id === data.id);
    if (!account) throw new Error('Account not found');
    const mergedIn = related.filter((a) => a.mergedIntoId === account.id);
    const ids = related.map((a) => a.id);
    const [mergedInto] = account.mergedIntoId
      ? await db
          .select({ id: financialAccounts.id, name: financialAccounts.name })
          .from(financialAccounts)
          .where(eq(financialAccounts.id, account.mergedIntoId))
      : [];
    const [pairedAsset] = account.pairedAssetId
      ? await db
          .select({ id: financialAccounts.id, name: financialAccounts.name })
          .from(financialAccounts)
          .where(eq(financialAccounts.id, account.pairedAssetId))
      : [];
    // Loans and offsets paired with this account (feature 02).
    const paired = await db
      .select({ ...accountColumns })
      .from(financialAccounts)
      .innerJoin(institutions, eq(institutions.id, financialAccounts.institutionId))
      .where(and(eq(financialAccounts.workspaceId, context.workspaceId), eq(financialAccounts.pairedAssetId, account.id)))
      .orderBy(asc(financialAccounts.classification), asc(financialAccounts.name));

    const balances = await db
      .select({
        id: balanceObservations.id,
        on: balanceObservations.observedOn,
        kind: balanceObservations.kind,
        balance: balanceObservations.balance,
        source: balanceObservations.source,
        accountId: balanceObservations.accountId,
        sourceFileId: balanceObservations.sourceFileId,
        fileName: sourceFiles.originalName,
        live: sql<boolean>`${sourceFiles.deletedAt} is null`,
      })
      .from(balanceObservations)
      .leftJoin(sourceFiles, eq(sourceFiles.id, balanceObservations.sourceFileId))
      .where(and(eq(balanceObservations.workspaceId, context.workspaceId), inArray(balanceObservations.accountId, ids)))
      .orderBy(
        desc(balanceObservations.observedOn),
        desc(sql`${balanceObservations.kind} = 'closing'`),
        desc(balanceObservations.createdAt),
      );

    const idList = sql.join(
      ids.map((id) => sql`${id}::uuid`),
      sql`, `,
    );
    const files = await db
      .select({
        id: statements.id,
        sourceFileId: sourceFiles.id,
        fileName: sourceFiles.originalName,
        periodStart: statements.periodStart,
        periodEnd: statements.periodEnd,
        status: statements.status,
        deletedAt: sourceFiles.deletedAt,
        rows: sql<number>`(select count(*)::int from source_records sr where sr.source_file_id = ${sourceFiles.id} and sr.account_id in (${idList}))`,
      })
      .from(statements)
      .innerJoin(sourceFiles, eq(sourceFiles.id, statements.sourceFileId))
      .where(
        and(
          eq(statements.workspaceId, context.workspaceId),
          or(
            inArray(
              sourceFiles.id,
              db.selectDistinct({ id: sourceRecords.sourceFileId }).from(sourceRecords).where(inArray(sourceRecords.accountId, ids)),
            ),
            inArray(
              sourceFiles.id,
              db
                .selectDistinct({ id: sql<string>`${balanceObservations.sourceFileId}` })
                .from(balanceObservations)
                .where(inArray(balanceObservations.accountId, ids)),
            ),
          ),
        ),
      )
      .orderBy(desc(statements.periodEnd), desc(sourceFiles.uploadedAt));

    return {
      account,
      /** The earliest date the account can be archived (closed) on. */
      latestActivityOn: await latestAccountActivity(db, context.workspaceId, account.id),
      mergedInto: mergedInto ?? null,
      mergedIn,
      pairedAsset: pairedAsset ?? null,
      paired,
      balance: balances.find((b) => b.live) ?? null,
      balances,
      statements: files.map((f) => ({ ...f, deletedAt: f.deletedAt?.toISOString() ?? null })),
    };
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

/** Archives an account by closing it on a date (feature 02); it stays viewable and can be unarchived. */
export const archiveAccount = createServerFn({ method: 'POST' })
  .middleware([workspaceMiddleware])
  .validator(closeAccountInput)
  .handler(async ({ context, data }) => {
    await closeAccount(getDb(), context.workspaceId, data.id, data.closedOn);
  });

export const unarchiveAccount = createServerFn({ method: 'POST' })
  .middleware([workspaceMiddleware])
  .validator(idInput)
  .handler(async ({ context, data }) => {
    await reopenAccount(getDb(), context.workspaceId, data.id);
  });

export const pairAccounts = createServerFn({ method: 'POST' })
  .middleware([workspaceMiddleware])
  .validator(pairAccountInput)
  .handler(async ({ context, data }) => {
    await pairAccount(getDb(), context.workspaceId, data.id, data.assetId);
  });

export const unpairAccounts = createServerFn({ method: 'POST' })
  .middleware([workspaceMiddleware])
  .validator(idInput)
  .handler(async ({ context, data }) => {
    await unpairAccount(getDb(), context.workspaceId, data.id);
  });

/**
 * An asset's equity over time (feature 02): at each month end from its first value, and today, its
 * value less its paired loans plus its paired offsets, each valued as net worth values it then.
 */
export const getEquity = createServerFn({ method: 'GET' })
  .middleware([workspaceMiddleware])
  .validator(idInput)
  .handler(async ({ context, data }) => {
    const [valuation, pairedRows] = await Promise.all([
      loadValuationInputs(context.workspaceId),
      getDb()
        .select({ id: financialAccounts.id })
        .from(financialAccounts)
        .where(and(eq(financialAccounts.workspaceId, context.workspaceId), eq(financialAccounts.pairedAssetId, data.id))),
    ]);
    const asset = valuation.accounts.find((a) => a.id === data.id);
    if (!asset) throw new Error('Account not found');
    const pairedIds = new Set(pairedRows.map((r) => r.id));
    const paired = valuation.accounts.filter((a) => pairedIds.has(a.id));

    const today = todayIso();
    const start = asset.manualValues ? asset.manualValues.map((v) => v.on).sort()[0] : asset.opening?.on;
    const dates: IsoDate[] = [];
    for (let on = start ? endOfMonth(start) : today; on < today; on = endOfMonth(addDays(on, 1))) dates.push(on);
    dates.push(today);

    const sum = (values: { aud: string | null }[]) => add('0', ...values.flatMap((v) => (v.aud === null ? [] : [v.aud])));
    const series = dates.map((on) => {
      const point = equityAt(asset, paired, on, valuation.prices, valuation.fx);
      return {
        on,
        equity: point.equity,
        value: point.value.aud,
        // Owed, as a positive amount.
        loans: neg(sum(point.loans)),
        offsets: sum(point.offsets),
        partial: point.partial,
        stale: point.stale,
      };
    });
    const now = equityAt(asset, paired, today, valuation.prices, valuation.fx);
    const input = (role: 'value' | 'loan' | 'offset') => (v: (typeof now)['value']) => ({
      id: v.id,
      name: v.name,
      role,
      aud: v.aud,
      status: v.status,
      knownAsOf: v.knownAsOf,
      notes: v.notes,
    });
    return {
      now: {
        on: today,
        equity: now.equity,
        partial: now.partial,
        stale: now.stale,
        inputs: [input('value')(now.value), ...now.loans.map(input('loan')), ...now.offsets.map(input('offset'))],
      },
      series: start ? series : [],
    };
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
