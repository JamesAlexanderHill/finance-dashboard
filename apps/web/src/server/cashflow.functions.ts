import { createServerFn } from '@tanstack/react-start';
import { and, asc, eq, gte, isNull, lte, ne, sql, type SQL } from 'drizzle-orm';
import { cashFlowQuery, legsQuery, type CashFlowQuery } from '@finance/contracts';
import { categories, eventLegs, events, financialAccounts, getDb } from '@finance/db';
import { buildSankey, UNCATEGORISED_EXPENSE, UNCATEGORISED_INCOME } from '@finance/ledger';
import { workspaceMiddleware } from './session';

const REPORTING_CURRENCY = 'AUD';

/** Cash-flow legs: active (projected), in period, not opening balances, not internal principal legs. */
function cashFlowConditions(workspaceId: string, q: Pick<CashFlowQuery, 'from' | 'to' | 'tagIds'>): SQL[] {
  const conditions = [
    eq(eventLegs.workspaceId, workspaceId),
    gte(eventLegs.occurredOn, q.from),
    lte(eventLegs.occurredOn, q.to),
    ne(events.type, 'opening_balance'),
    sql`not (${events.isInternal} and ${eventLegs.role} in ('principal', 'line_item'))`,
  ];
  if (q.tagIds.length) {
    conditions.push(sql`${eventLegs.tagIds} && array[${sql.join(q.tagIds.map((t) => sql`${t}::uuid`), sql`, `)}]`);
  }
  return conditions;
}

async function loadCategories(workspaceId: string) {
  return getDb()
    .select({ id: categories.id, parentId: categories.parentId, name: categories.name, kind: categories.kind })
    .from(categories)
    .where(and(eq(categories.workspaceId, workspaceId), isNull(categories.archivedAt)))
    .orderBy(asc(categories.sortOrder), asc(categories.name));
}

export const getCashFlow = createServerFn({ method: 'GET' })
  .middleware([workspaceMiddleware])
  .validator(cashFlowQuery)
  .handler(async ({ context, data }) => {
    const [legs, cats] = await Promise.all([
      getDb()
        .select({ amount: eventLegs.amount, categoryId: eventLegs.categoryId, commodity: eventLegs.commodity })
        .from(eventLegs)
        .innerJoin(events, eq(events.id, eventLegs.eventId))
        .where(and(...cashFlowConditions(context.workspaceId, data))),
      loadCategories(context.workspaceId),
    ]);

    // FX is a later slice: non-AUD legs are flagged and left out rather than converted 1:1.
    const reportable = legs.filter((l) => l.commodity === REPORTING_CURRENCY);
    const result = buildSankey(reportable, cats, data.focusId);
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
      excludedForeignLegs: legs.length - reportable.length,
      legCount: reportable.length,
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
