import { createServerFn } from '@tanstack/react-start';
import { and, asc, eq, gte, isNull, lte, ne, sql, type SQL } from 'drizzle-orm';
import { cashFlowQuery, legsQuery } from '@finance/contracts';
import { eventLegs, events, financialAccounts, getDb } from '@finance/db';
import { buildSankey, UNCATEGORISED_EXPENSE, UNCATEGORISED_INCOME } from '@finance/ledger';
import { cashFlowConditions, loadCashFlowLegs, loadCategories } from './cashflow.server';
import { workspaceMiddleware } from './session';

export const getCashFlow = createServerFn({ method: 'GET' })
  .middleware([workspaceMiddleware])
  .validator(cashFlowQuery)
  .handler(async ({ context, data }) => {
    const [converted, cats] = await Promise.all([loadCashFlowLegs(context.workspaceId, data), loadCategories(context.workspaceId)]);
    const result = buildSankey(converted.legs, cats, data.focusId);
    const byId = new Map(cats.map((c) => [c.id, c]));
    const pathFor = (id: string) => {
      const path: string[] = [];
      for (let c = byId.get(id); c; c = c.parentId ? byId.get(c.parentId) : undefined) path.unshift(c.name);
      return path;
    };

    return {
      ...result,
      nodes: result.nodes.map((n) => ({ ...n, root: n.categoryId ? (pathFor(n.categoryId)[0] ?? null) : null })),
      focus: data.focusId && byId.has(data.focusId) ? { id: data.focusId, path: pathFor(data.focusId) } : null,
      /** Foreign legs with no FX rate on or before their date (left out, never converted 1:1). */
      unconvertedLegs: converted.unconverted,
      /** Foreign legs converted with a stale or trade-only rate. */
      staleConvertedLegs: converted.staleConverted,
      legCount: converted.legs.length,
    };
  });

/** Lists the legs behind a Sankey node: a category subtree, or the uncategorised income/expense legs. */
export const getNodeLegs = createServerFn({ method: 'GET' })
  .middleware([workspaceMiddleware])
  .validator(legsQuery)
  .handler(async ({ context, data }) => {
    const conditions = cashFlowConditions(context.workspaceId, data);
    if (data.node === UNCATEGORISED_INCOME) conditions.push(isNull(eventLegs.categoryId), sql`${eventLegs.amount} > 0`);
    else if (data.node === UNCATEGORISED_EXPENSE) conditions.push(isNull(eventLegs.categoryId), sql`${eventLegs.amount} < 0`);
    else {
      const id = data.node.replace(/:other$/, '');
      if (!/^[0-9a-f-]{36}$/.test(id)) return [];
      conditions.push(
        data.node.endsWith(':other')
          ? eq(eventLegs.categoryId, id)
          : sql`${eventLegs.categoryId} in (
              with recursive sub as (
                select id from categories where id = ${id} and workspace_id = ${context.workspaceId}
                union all select c.id from categories c join sub on c.parent_id = sub.id
              ) select id from sub)`,
      );
    }
    return getDb()
      .select({
        id: eventLegs.id,
        transactionId: eventLegs.transactionId,
        occurredOn: eventLegs.occurredOn,
        description: eventLegs.description,
        amount: eventLegs.amount,
        commodity: eventLegs.commodity,
        accountName: financialAccounts.name,
      })
      .from(eventLegs)
      .innerJoin(events, eq(events.id, eventLegs.eventId))
      .innerJoin(financialAccounts, eq(financialAccounts.id, eventLegs.accountId))
      .where(and(...conditions))
      .orderBy(asc(eventLegs.occurredOn))
      .limit(500);
  });
