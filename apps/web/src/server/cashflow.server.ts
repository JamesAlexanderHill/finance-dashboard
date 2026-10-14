import { and, asc, eq, gte, isNull, lte, ne, sql, type SQL } from 'drizzle-orm';
import { REPORTING_CURRENCY } from '@finance/domain';
import { categories, eventLegs, events, getDb } from '@finance/db';
import { convert, priceAt, type DatedLeg } from '@finance/ledger';
import { loadFxRates } from './valuation.server';

export interface CashFlowFilter {
  from: string;
  to: string;
  tagIds: string[];
}

/** Cash-flow legs: active (projected), in period, not opening balances, not internal principal legs. */
export function cashFlowConditions(workspaceId: string, q: CashFlowFilter): SQL[] {
  const conditions = [
    eq(eventLegs.workspaceId, workspaceId),
    gte(eventLegs.occurredOn, q.from),
    lte(eventLegs.occurredOn, q.to),
    ne(events.type, 'opening_balance'),
    sql`not (${events.isInternal} and ${eventLegs.role} in ('principal', 'line_item'))`,
  ];
  if (q.tagIds.length) {
    conditions.push(
      sql`${eventLegs.tagIds} && array[${sql.join(
        q.tagIds.map((t) => sql`${t}::uuid`),
        sql`, `,
      )}]`,
    );
  }
  return conditions;
}

export async function loadCategories(workspaceId: string) {
  return getDb()
    .select({ id: categories.id, parentId: categories.parentId, name: categories.name, kind: categories.kind })
    .from(categories)
    .where(and(eq(categories.workspaceId, workspaceId), isNull(categories.archivedAt)))
    .orderBy(asc(categories.sortOrder), asc(categories.name));
}

export interface ConvertedLegs {
  legs: DatedLeg[];
  /** Non-AUD legs with no rate on or before their date: left out, never converted 1:1. */
  unconverted: number;
  /** Non-AUD legs converted with a stale or trade-only rate. */
  staleConverted: number;
}

/** Cash-flow legs in AUD: foreign legs are converted with the FX rate that applied on their date. */
export async function loadCashFlowLegs(workspaceId: string, filter: CashFlowFilter): Promise<ConvertedLegs> {
  const [rows, fx] = await Promise.all([
    getDb()
      .select({
        amount: eventLegs.amount,
        categoryId: eventLegs.categoryId,
        commodity: eventLegs.commodity,
        occurredOn: eventLegs.occurredOn,
      })
      .from(eventLegs)
      .innerJoin(events, eq(events.id, eventLegs.eventId))
      .where(and(...cashFlowConditions(workspaceId, filter))),
    loadFxRates(workspaceId),
  ]);
  const result: ConvertedLegs = { legs: [], unconverted: 0, staleConverted: 0 };
  for (const r of rows) {
    if (r.commodity === REPORTING_CURRENCY) {
      result.legs.push({ amount: r.amount, categoryId: r.categoryId, occurredOn: r.occurredOn });
      continue;
    }
    const rate = priceAt(fx.get(r.commodity) ?? [], r.occurredOn);
    if (!rate) {
      result.unconverted++;
      continue;
    }
    if (rate.stale || rate.tradePriced) result.staleConverted++;
    result.legs.push({ amount: convert(r.amount, rate), categoryId: r.categoryId, occurredOn: r.occurredOn });
  }
  return result;
}
