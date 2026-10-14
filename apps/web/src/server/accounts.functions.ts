import { createServerFn } from '@tanstack/react-start';
import { and, asc, eq, sql } from 'drizzle-orm';
import { updateAccountInput } from '@finance/contracts';
import { financialAccounts, getDb, institutions } from '@finance/db';
import { workspaceMiddleware } from './session';

export const listAccounts = createServerFn({ method: 'GET' })
  .middleware([workspaceMiddleware])
  .handler(async ({ context }) => {
    return getDb()
      .select({
        id: financialAccounts.id,
        name: financialAccounts.name,
        institution: institutions.name,
        accountType: financialAccounts.accountType,
        classification: financialAccounts.classification,
        commodity: financialAccounts.commodity,
        maskedIdentifier: financialAccounts.maskedIdentifier,
        status: financialAccounts.status,
        // Latest observed balance from a live statement; never inferred from partial history.
        balance: sql<{ on: string; balance: string } | null>`(
          select json_build_object('on', bo.observed_on, 'balance', bo.balance::text)
          from balance_observations bo left join source_files sf on sf.id = bo.source_file_id
          where bo.account_id = ${financialAccounts.id} and (bo.source_file_id is null or sf.deleted_at is null)
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
