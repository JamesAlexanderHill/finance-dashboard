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
    const previous = previousRange(range);
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

/** Both periods bucketed at the same resolution; previous buckets line up with current ones by index. */
function bucketPair(range: DateRange, resolution: Parameters<typeof bucketsIn>[1]) {
  const current = bucketsIn(range, resolution);
  return {
    resolution: current.resolution,
    current: current.buckets,
    previous: bucketsIn(previousRange(range), current.resolution).buckets,
  };
}

/** Account groups the net worth chart stacks, in drawing order; liabilities stack below the line. */
export const ASSET_GROUPS = ['Cash', 'Investments', 'Property & other'] as const;
export const LIABILITY_GROUPS = ['Loans', 'Credit cards', 'Other liabilities'] as const;
function groupOf(a: { classification: 'asset' | 'liability'; kind: string; accountType: string }): string {
  if (a.classification === 'liability')
    return a.accountType === 'loan' ? 'Loans' : a.accountType === 'credit_card' ? 'Credit cards' : 'Other liabilities';
  if (a.kind === 'instrument' || a.accountType === 'investment' || a.accountType === 'brokerage') return 'Investments';
  return a.accountType === 'bank' || a.accountType === 'payment_processor' ? 'Cash' : 'Property & other';
}

/** Net worth, split by account group, at the end of each bucket of the page period and of the previous period. */
export const getNetWorthSeries = createServerFn({ method: 'GET' })
  .middleware([workspaceMiddleware])
  .validator(dashboardSeriesQuery)
  .handler(async ({ context, data }) => {
    const today = todayIso();
    const range: DateRange = { from: data.from, to: data.to };
    const valuation = await loadValuationInputs(context.workspaceId);
    const groupById = new Map(valuation.accounts.map((a) => [a.id, groupOf(a)]));
    const { resolution, current, previous } = bucketPair(range, data.resolution);
    const series = (buckets: Period[]) =>
      buckets.map((b) => {
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
      });
    return {
      resolution,
      range: describe(range),
      previous: describe(previousRange(range)),
      current: series(current),
      prior: series(previous),
    };
  });

/** Income, expenses and expenses by category per bucket of the page period and of the previous period. */
export const getFlowSeries = createServerFn({ method: 'GET' })
  .middleware([workspaceMiddleware])
  .validator(dashboardSeriesQuery)
  .handler(async ({ context, data }) => {
    const { workspaceId } = context;
    const today = todayIso();
    const range: DateRange = { from: data.from, to: data.to };
    const { resolution, current, previous } = bucketPair(range, data.resolution);
    const [cashLegs, cats] = await Promise.all([
      loadCashFlowLegs(workspaceId, { from: previous[0]!.from, to: range.to, tagIds: data.tagIds }),
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
    const segmentIds = [...new Set([...now, ...prior].flatMap((b) => Object.keys(b.segments)))].sort((a, b) => order(a) - order(b));
    return {
      resolution,
      range: describe(range),
      previous: describe(previousRange(range)),
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
