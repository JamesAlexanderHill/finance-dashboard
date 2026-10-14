import { add, isPositive, neg, sub, type DecimalString, type IsoDate } from '@finance/shared';
import type { Period } from './periods';
import type { SankeyCategory, SankeyLeg } from './sankey';

export interface DatedLeg extends SankeyLeg {
  occurredOn: IsoDate;
}

export interface PeriodCashFlow extends Period {
  income: DecimalString;
  outflow: DecimalString;
  net: DecimalString;
}

const rootsOf = (categories: readonly SankeyCategory[]) => {
  const byId = new Map(categories.map((c) => [c.id, c]));
  return (id: string) => {
    let c = byId.get(id);
    while (c?.parentId && byId.has(c.parentId)) c = byId.get(c.parentId);
    return c;
  };
};

/** Income, outflows and net cash flow per period (same rules as the Sankey: refunds reduce spending). */
export function cashFlowByPeriod(
  legs: readonly DatedLeg[],
  categories: readonly SankeyCategory[],
  periods: readonly Period[],
): PeriodCashFlow[] {
  const root = rootsOf(categories);
  return periods.map((p) => {
    let income = '0';
    let outflow = '0';
    for (const leg of legs) {
      if (leg.occurredOn < p.from || leg.occurredOn > p.to) continue;
      const kind = leg.categoryId ? root(leg.categoryId)?.kind : undefined;
      const isIncome = kind ? kind === 'income' : isPositive(leg.amount);
      if (isIncome) income = add(income, leg.amount);
      else outflow = add(outflow, neg(leg.amount));
    }
    return { ...p, income, outflow, net: sub(income, outflow) };
  });
}

export const UNCATEGORISED = 'uncategorised';

export interface ExpenseBreakdown extends Period {
  /** Spending per segment (category ID, or `uncategorised`); refunds reduce it. */
  segments: Record<string, DecimalString>;
}

/**
 * Spending per period split by the children of `parentId` (top-level expense categories when null),
 * for stacked bars with drill-down. Legs deeper in the tree roll up to that child; legs directly on the
 * parent appear as the parent's own segment.
 */
export function expensesByPeriod(
  legs: readonly DatedLeg[],
  categories: readonly SankeyCategory[],
  periods: readonly Period[],
  parentId: string | null,
): ExpenseBreakdown[] {
  const byId = new Map(categories.map((c) => [c.id, c]));
  const root = rootsOf(categories);
  /** The segment a category rolls up to under the parent, or null if it is outside the parent's subtree. */
  const segmentOf = (id: string): string | null => {
    let c = byId.get(id);
    while (c) {
      if ((c.parentId ?? null) === parentId) return c.id;
      if (c.id === parentId) return c.id;
      c = c.parentId ? byId.get(c.parentId) : undefined;
    }
    return null;
  };
  return periods.map((p) => {
    const segments: Record<string, DecimalString> = {};
    for (const leg of legs) {
      if (leg.occurredOn < p.from || leg.occurredOn > p.to) continue;
      let segment: string | null;
      if (!leg.categoryId) segment = parentId === null && !isPositive(leg.amount) ? UNCATEGORISED : null;
      else segment = root(leg.categoryId)?.kind === 'expense' ? segmentOf(leg.categoryId) : null;
      if (segment) segments[segment] = add(segments[segment] ?? '0', neg(leg.amount));
    }
    return { ...p, segments };
  });
}
