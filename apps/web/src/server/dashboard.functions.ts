import { createServerFn } from '@tanstack/react-start';
import { and, desc, eq, ne } from 'drizzle-orm';
import { dashboardQuery } from '@finance/contracts';
import { events, getDb } from '@finance/db';
import { REPORTING_CURRENCY } from '@finance/domain';
import {
  buildSankey,
  cashFlowByPeriod,
  expensesByPeriod,
  netWorthAt,
  periodSeries,
  UNCATEGORISED,
  type AccountValue,
} from '@finance/ledger';
import { mul, todayIso } from '@finance/shared';
import { loadCashFlowLegs, loadCategories } from './cashflow.server';
import { workspaceMiddleware } from './session';
import { loadValuationInputs } from './valuation.server';

const RECENT_EVENTS = 8;

/** Everything the dashboard shows for one setting of the global period control. */
export const getDashboard = createServerFn({ method: 'GET' })
  .middleware([workspaceMiddleware])
  .validator(dashboardQuery)
  .handler(async ({ context, data }) => {
    const { workspaceId } = context;
    const today = todayIso();
    const periods =
      data.granularity === 'custom' && data.from && data.to
        ? periodSeries('custom', { from: data.from, to: data.to }, data.n)
        : periodSeries(data.granularity === 'custom' ? 'month' : data.granularity, { date: data.date ?? today }, data.n);
    const selected = periods.at(-1)!;

    const [valuation, cashLegs, cats, recent] = await Promise.all([
      loadValuationInputs(workspaceId),
      loadCashFlowLegs(workspaceId, { from: periods[0]!.from, to: selected.to, tagIds: data.tagIds }),
      loadCategories(workspaceId),
      getDb()
        .select({ id: events.id, type: events.type, status: events.status, occurredOn: events.occurredOn, description: events.description })
        .from(events)
        .where(and(eq(events.workspaceId, workspaceId), ne(events.type, 'opening_balance')))
        .orderBy(desc(events.occurredOn))
        .limit(RECENT_EVENTS),
    ]);

    // Net worth at each period end (or today, for a period still in progress).
    const netWorth = periods.map((p) => {
      const point = netWorthAt(valuation.accounts, p.to < today ? p.to : today, valuation.prices, valuation.fx);
      return {
        label: p.label,
        on: point.on,
        assets: point.assets,
        liabilities: point.liabilities,
        netWorth: point.netWorth,
        partial: point.partial,
        stale: point.stale,
        notes: point.accounts.filter((a) => a.notes.length).map((a) => `${a.name}: ${a.notes.join('; ')}`),
      };
    });

    const now = netWorthAt(valuation.accounts, today, valuation.prices, valuation.fx);
    const fxOverrides = new Map(
      [...valuation.overrides].flatMap(([instrumentId, o]) => {
        const i = valuation.instruments.get(instrumentId);
        return i?.exchange === 'FX' ? [[i.symbol, o.price] as const] : [];
      }),
    );
    /**
     * What a value would be at the user's override price or FX rate, where one is set. Display only:
     * never part of any total.
     */
    const overrideValue = (a: AccountValue, instrumentId: string | null): string | null => {
      const priceOverride = instrumentId ? valuation.overrides.get(instrumentId)?.price : undefined;
      const fxOverride = fxOverrides.get(a.currency);
      if (!a.quantity || (!priceOverride && !fxOverride)) return null;
      const price = a.kind === 'instrument' ? (priceOverride ?? a.price?.price) : '1';
      const rate = a.currency === REPORTING_CURRENCY ? '1' : (fxOverride ?? a.fx?.price);
      return price && rate ? mul(mul(a.quantity, price), rate) : null;
    };
    const byId = new Map(valuation.accounts.map((a) => [a.id, a]));
    const accounts = now.accounts
      .filter((a) => a.quantity !== null || a.status === 'untracked')
      .map((a) => {
        const input = byId.get(a.id)!;
        return {
          id: a.id,
          name: a.name,
          institution: input.institution,
          group:
            input.provider === 'manual'
              ? 'Manual'
              : a.classification === 'liability'
                ? 'Liabilities'
                : a.kind === 'instrument'
                  ? 'Investments'
                  : 'Cash',
          aud: a.aud,
          status: a.status,
          notes: a.notes,
          knownAsOf: a.knownAsOf,
          overrideValue: overrideValue(a, input.instrumentId ?? null),
        };
      });

    const flows = cashFlowByPeriod(cashLegs.legs, cats, periods);
    const expenses = expensesByPeriod(cashLegs.legs, cats, periods, data.expenseFocus);
    const segmentIds = [...new Set(expenses.flatMap((e) => Object.keys(e.segments)))];
    const catById = new Map(cats.map((c) => [c.id, c]));
    const order = (id: string) => (id === UNCATEGORISED ? 1e9 : cats.findIndex((c) => c.id === id));
    const selectedLegs = cashLegs.legs.filter((l) => l.occurredOn >= selected.from && l.occurredOn <= selected.to);
    const sankey = buildSankey(selectedLegs, cats, null);
    const rootName = (id: string | null) => {
      let c = id ? catById.get(id) : undefined;
      while (c?.parentId && catById.has(c.parentId)) c = catById.get(c.parentId);
      return c?.name ?? null;
    };

    return {
      periods,
      selected,
      netWorth,
      current: {
        on: today,
        assets: now.assets,
        liabilities: now.liabilities,
        netWorth: now.netWorth,
        partial: now.partial,
        stale: now.stale,
        accounts,
      },
      flows,
      expenses: {
        focus:
          data.expenseFocus && catById.has(data.expenseFocus)
            ? { id: data.expenseFocus, name: catById.get(data.expenseFocus)!.name }
            : null,
        segments: segmentIds
          .sort((a, b) => order(a) - order(b))
          .map((id) => ({
            id,
            name: id === UNCATEGORISED ? 'Uncategorised' : catById.get(id)!.name,
            root: id === UNCATEGORISED ? null : rootName(id),
            drillable: id !== UNCATEGORISED && id !== data.expenseFocus && cats.some((c) => c.parentId === id),
          })),
        periods: expenses,
      },
      totals: sankey.totals,
      sankey: { nodes: sankey.nodes.map((n) => ({ ...n, root: rootName(n.categoryId) })), links: sankey.links },
      fx: { unconverted: cashLegs.unconverted, staleConverted: cashLegs.staleConverted },
      recent,
    };
  });
