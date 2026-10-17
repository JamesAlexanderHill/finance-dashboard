import { createServerFn } from '@tanstack/react-start';
import { dashboardRange, dashboardSeriesQuery } from '@finance/contracts';
import {
  bucketsIn,
  buildSankey,
  cashFlowByPeriod,
  expensesByPeriod,
  netWorthAt,
  UNCATEGORISED,
  type DatedLeg,
  type Period,
  type SankeyCategory,
} from '@finance/ledger';
import { add, addDays, neg, previousRange, rangeLabel, todayIso, type DateRange } from '@finance/shared';
import { loadCashFlowLegs, loadCategories } from './cashflow.server';
import { workspaceMiddleware } from './session';
import { loadValuationInputs } from './valuation.server';

const describe = (r: DateRange) => ({ ...r, label: rangeLabel(r) });
const within = (legs: readonly DatedLeg[], r: DateRange) => legs.filter((l) => l.occurredOn >= r.from && l.occurredOn <= r.to);
const sumSegments = (segments: Record<string, string>) => add('0', ...Object.values(segments));

function categoryNames(cats: readonly SankeyCategory[]) {
  const byId = new Map(cats.map((c) => [c.id, c]));
  const root = (id: string | null) => {
    let c = id ? byId.get(id) : undefined;
    while (c?.parentId && byId.has(c.parentId)) c = byId.get(c.parentId);
    return c?.name ?? null;
  };
  const name = (id: string) => (id === UNCATEGORISED ? 'Uncategorised' : (byId.get(id)?.name ?? 'Unknown'));
  return { byId, root, name };
}

/** The summary cards for the page period, each with the previous period's figures to compare. */
export const getDashboardSummary = createServerFn({ method: 'GET' })
  .middleware([workspaceMiddleware])
  .validator(dashboardRange)
  .handler(async ({ context, data }) => {
    const { workspaceId } = context;
    const today = todayIso();
    const range: DateRange = { from: data.from, to: data.to };
    const previous = compareRangeOf(data);
    const [valuation, cashLegs, cats] = await Promise.all([
      loadValuationInputs(workspaceId),
      loadCashFlowLegs(workspaceId, { from: previous.from, to: range.to, tagIds: data.tagIds }),
      loadCategories(workspaceId),
    ]);
    const { name } = categoryNames(cats);

    // Net worth at the end of the period (or today, if it is still running) against its start.
    const clip = (d: string) => (d < today ? d : today);
    const valueAt = (on: string) => {
      const p = netWorthAt(valuation.accounts, on, valuation.prices, valuation.fx);
      return { on, assets: p.assets, liabilities: p.liabilities, netWorth: p.netWorth, partial: p.partial, stale: p.stale };
    };
    const end = valueAt(clip(range.to));
    const start = valueAt(clip(addDays(range.from, -1)));

    const [flowPrev, flowNow] = cashFlowByPeriod(
      cashLegs.legs,
      cats,
      [previous, range].map((r) => ({ ...r, label: '' })),
    );
    const [expPrev, expNow] = expensesByPeriod(
      cashLegs.legs,
      cats,
      [previous, range].map((r) => ({ ...r, label: '' })),
      null,
    );
    const top = Object.entries(expNow!.segments).sort((a, b) => Number(b[1]) - Number(a[1]))[0];

    const sankeyNow = buildSankey(within(cashLegs.legs, range), cats, null);
    const sankeyPrev = buildSankey(within(cashLegs.legs, previous), cats, null);

    return {
      range: describe(range),
      previous: describe(previous),
      netWorth: { start, end },
      flows: {
        current: {
          income: flowNow!.income,
          expenses: flowNow!.outflow,
          net: flowNow!.net,
          spending: sankeyNow.totals.spending,
          saved: sankeyNow.totals.saved,
        },
        previous: {
          income: flowPrev!.income,
          expenses: flowPrev!.outflow,
          net: flowPrev!.net,
          spending: sankeyPrev.totals.spending,
          saved: sankeyPrev.totals.saved,
        },
      },
      topCategory: top ? { id: top[0], name: name(top[0]), amount: top[1], previous: expPrev!.segments[top[0]] ?? '0' } : null,
      fx: { unconverted: cashLegs.unconverted, staleConverted: cashLegs.staleConverted },
    };
  });

/** The period compared against: the one the client asked for, or the one before the page period. */
const compareRangeOf = (data: { from: string; to: string; compareFrom?: string; compareTo?: string }): DateRange =>
  data.compareFrom && data.compareTo && data.compareFrom <= data.compareTo
    ? { from: data.compareFrom, to: data.compareTo }
    : previousRange({ from: data.from, to: data.to });

/** The account group the net worth chart stacks an account under. */
function groupOf(a: { classification: 'asset' | 'liability'; kind: string; accountType: string }): string {
  if (a.classification === 'liability')
    return a.accountType === 'loan' ? 'Loans' : a.accountType === 'credit_card' ? 'Credit cards' : 'Other liabilities';
  if (a.kind === 'instrument' || a.accountType === 'investment' || a.accountType === 'brokerage') return 'Investments';
  return a.accountType === 'bank' || a.accountType === 'payment_processor' ? 'Cash' : 'Property & other';
}

/** Net worth, split by account group, at the end of each bucket of the page period. */
export const getNetWorthSeries = createServerFn({ method: 'GET' })
  .middleware([workspaceMiddleware])
  .validator(dashboardSeriesQuery)
  .handler(async ({ context, data }) => {
    const today = todayIso();
    const range: DateRange = { from: data.from, to: data.to };
    const valuation = await loadValuationInputs(context.workspaceId);
    const groupById = new Map(valuation.accounts.map((a) => [a.id, groupOf(a)]));
    const { resolution, buckets } = bucketsIn(range, data.resolution);
    return {
      resolution,
      range: describe(range),
      current: buckets.map((b) => {
        // Buckets that start after today have no value yet.
        if (b.from > today) return { label: b.label, on: b.to, value: null };
        const p = netWorthAt(valuation.accounts, b.to < today ? b.to : today, valuation.prices, valuation.fx);
        return {
          label: b.label,
          on: p.on,
          value: {
            assets: p.assets,
            liabilities: p.liabilities,
            netWorth: p.netWorth,
            /** AUD per account group; liabilities are amounts owed (positive). */
            groups: p.accounts.reduce<Record<string, string>>((out, a) => {
              if (!a.aud) return out;
              const group = groupById.get(a.id)!;
              out[group] = add(out[group] ?? '0', a.classification === 'liability' ? neg(a.aud) : a.aud);
              return out;
            }, {}),
            partial: p.partial,
            stale: p.stale,
            notes: p.accounts.filter((a) => a.notes.length).map((a) => `${a.name}: ${a.notes.join('; ')}`),
          },
        };
      }),
    };
  });

/**
 * Income, expenses and expenses by category per bucket of the page period, and the compared period
 * bucketed at the same resolution (its buckets line up with the page period's by index).
 */
export const getFlowSeries = createServerFn({ method: 'GET' })
  .middleware([workspaceMiddleware])
  .validator(dashboardSeriesQuery)
  .handler(async ({ context, data }) => {
    const { workspaceId } = context;
    const today = todayIso();
    const range: DateRange = { from: data.from, to: data.to };
    const compared = compareRangeOf(data);
    const { resolution, buckets: current } = bucketsIn(range, data.resolution);
    const previous = bucketsIn(compared, resolution).buckets;
    const [cashLegs, cats] = await Promise.all([
      loadCashFlowLegs(workspaceId, {
        from: compared.from < range.from ? compared.from : range.from,
        to: compared.to > range.to ? compared.to : range.to,
        tagIds: data.tagIds,
      }),
      loadCategories(workspaceId),
    ]);
    const { byId, root, name } = categoryNames(cats);
    const focus = data.expenseFocus && byId.has(data.expenseFocus) ? data.expenseFocus : null;

    const series = (buckets: Period[]) => {
      const flows = cashFlowByPeriod(cashLegs.legs, cats, buckets);
      const expenses = expensesByPeriod(cashLegs.legs, cats, buckets, focus);
      return buckets.map((b, i) => ({
        label: b.label,
        future: b.from > today,
        income: flows[i]!.income,
        expenses: flows[i]!.outflow,
        net: flows[i]!.net,
        segments: expenses[i]!.segments,
        segmentTotal: sumSegments(expenses[i]!.segments),
      }));
    };
    const now = series(current);
    const prior = series(previous);

    const order = (id: string) => (id === UNCATEGORISED ? 1e9 : cats.findIndex((c) => c.id === id));
    const segmentIds = [...new Set(now.flatMap((b) => Object.keys(b.segments)))].sort((a, b) => order(a) - order(b));
    return {
      resolution,
      range: describe(range),
      previous: describe(compared),
      current: now,
      prior,
      focus: focus ? { id: focus, name: name(focus) } : null,
      segments: segmentIds.map((id) => ({
        id,
        name: name(id),
        root: id === UNCATEGORISED ? null : root(id),
        drillable: id !== UNCATEGORISED && id !== focus && cats.some((c) => c.parentId === id),
      })),
      fx: { unconverted: cashLegs.unconverted, staleConverted: cashLegs.staleConverted },
    };
  });
