import { queryOptions, useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { z } from 'zod';
import { add, addDays, todayIso } from '@finance/shared';
import { PeriodChart, type PeriodSeries } from '../../components/period-chart';
import { SankeyChart } from '../../components/sankey-chart';
import { Badge, Button, Card, Empty, PageHeader } from '../../components/ui';
import { money, shortDate } from '../../lib/format';
import { listCategories } from '../../server/categories.functions';
import { getDashboard } from '../../server/dashboard.functions';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const searchSchema = z.object({
  granularity: z.enum(['week', 'month', 'quarter', 'year', 'custom']).optional(),
  n: z.number().int().min(1).max(24).optional(),
  date: isoDate.optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  tags: z.array(z.uuid()).optional(),
  focus: z.uuid().optional(),
});
type Search = z.infer<typeof searchSchema>;

const dashboardQuery = (s: Search) =>
  queryOptions({
    queryKey: ['dashboard', s],
    queryFn: () =>
      getDashboard({
        data: {
          granularity: s.granularity ?? 'month',
          n: s.n ?? 6,
          date: s.date,
          from: s.from,
          to: s.to,
          tagIds: s.tags ?? [],
          expenseFocus: s.focus ?? null,
        },
      }),
  });
const categoriesQuery = queryOptions({ queryKey: ['categories'], queryFn: () => listCategories() });

export const Route = createFileRoute('/_app/')({
  validateSearch: searchSchema,
  loaderDeps: ({ search }) => search,
  loader: ({ context, deps }) =>
    Promise.all([context.queryClient.ensureQueryData(dashboardQuery(deps)), context.queryClient.ensureQueryData(categoriesQuery)]),
  component: Dashboard,
});

type Data = Awaited<ReturnType<typeof getDashboard>>;

const compact = (n: number) => {
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}m`;
  if (abs >= 1000) return `${sign}$${(abs / 1000).toFixed(abs >= 10_000 ? 0 : 1)}k`;
  return `${sign}$${abs.toFixed(0)}`;
};
const moneyNumber = (n: number) => money(n.toFixed(2));
const toNumber = (v: string | null | undefined) => (v == null ? null : Number(v));

/** Top-level categories keep the colours the Sankey uses; drilled-in children take slots in order. */
const ROOT_COLORS: Record<string, string> = { Savings: 'var(--series-2)', Essentials: 'var(--series-3)', Lifestyle: 'var(--series-4)' };
const SLOTS = [1, 2, 3, 4, 5, 6, 7, 8].map((i) => `var(--series-${i})`);

function Dashboard() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const { data } = useSuspenseQuery(dashboardQuery(search));
  const { data: cats } = useSuspenseQuery(categoriesQuery);
  const set = (patch: Partial<Search>) => navigate({ search: (prev) => ({ ...prev, ...patch }) });

  const granularity = search.granularity ?? 'month';
  const step = (direction: -1 | 1) => {
    if (granularity === 'custom') return;
    const anchor = direction < 0 ? addDays(data.selected.from, -1) : addDays(data.selected.to, 1);
    set({ date: anchor > todayIso() ? undefined : anchor });
  };

  return (
    <>
      <PageHeader
        title="Dashboard"
        description={`${data.selected.label} compared with the previous ${data.periods.length - 1} ${granularity === 'custom' ? 'periods' : `${granularity}s`}`}
      />

      {/* One global control drives every view below. */}
      <Card className="mb-6 flex flex-wrap items-center gap-2 p-3 text-sm">
        <div
          className="flex overflow-hidden rounded-md border"
          style={{ borderColor: 'var(--border)' }}
          role="group"
          aria-label="Granularity"
        >
          {(['week', 'month', 'quarter', 'year', 'custom'] as const).map((g) => (
            <button
              key={g}
              onClick={() =>
                set(
                  g === 'custom'
                    ? { granularity: g, from: data.selected.from, to: data.selected.to }
                    : { granularity: g, from: undefined, to: undefined },
                )
              }
              className={`px-2.5 py-1 capitalize ${granularity === g ? 'bg-accent text-accent-ink' : 'bg-surface'}`}
            >
              {g}
            </button>
          ))}
        </div>
        {granularity === 'custom' ? (
          <>
            <input
              type="date"
              value={search.from ?? data.selected.from}
              onChange={(e) => e.target.value && set({ from: e.target.value })}
              className="border-line bg-surface rounded border px-2 py-1"
              aria-label="From"
            />
            <input
              type="date"
              value={search.to ?? data.selected.to}
              onChange={(e) => e.target.value && set({ to: e.target.value })}
              className="border-line bg-surface rounded border px-2 py-1"
              aria-label="To"
            />
          </>
        ) : (
          <>
            <Button onClick={() => step(-1)} aria-label="Previous period">
              ←
            </Button>
            <span className="min-w-24 text-center font-medium">{data.selected.label}</span>
            <Button onClick={() => step(1)} disabled={data.selected.to >= todayIso()} aria-label="Next period">
              →
            </Button>
          </>
        )}
        <label className="ml-2 flex items-center gap-1.5">
          Compare with
          <select
            value={search.n ?? 6}
            onChange={(e) => set({ n: Number(e.target.value) })}
            className="border-line bg-surface rounded border px-1.5 py-1"
          >
            {[1, 2, 3, 4, 6, 8, 12, 24].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
          previous
        </label>
        {cats.tags.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 sm:ml-auto">
            <span className="text-muted">Tags</span>
            {cats.tags.map((tag) => {
              const on = search.tags?.includes(tag.id);
              const next = on ? (search.tags ?? []).filter((t) => t !== tag.id) : [...(search.tags ?? []), tag.id];
              return (
                <button
                  key={tag.id}
                  onClick={() => set({ tags: next.length ? next : undefined })}
                  className={`rounded-full border px-2 py-0.5 text-xs ${on ? 'border-accent bg-accent text-accent-ink' : 'border-line bg-surface'}`}
                >
                  {tag.name}
                </button>
              );
            })}
          </div>
        )}
      </Card>

      <Summary data={data} />
      <NetWorthSection data={data} />
      <CashFlowSection data={data} />
      <ExpensesSection data={data} onFocus={(focus) => set({ focus })} />
      <div className="grid gap-6 lg:grid-cols-2">
        <AccountsSection data={data} />
        <RecentEvents data={data} />
      </div>
    </>
  );
}

function Tile({
  label,
  value,
  sub,
  tone,
  badge,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: 'negative';
  badge?: React.ReactNode;
}) {
  return (
    <Card className="p-3">
      <div className="text-muted flex items-center gap-2 text-xs">
        {label} {badge}
      </div>
      <div className={`tabular text-lg font-semibold ${tone === 'negative' ? 'text-negative' : ''}`}>{value}</div>
      {sub && <div className="text-muted text-xs">{sub}</div>}
    </Card>
  );
}

const QualityBadge = ({ partial, stale }: { partial: boolean; stale: boolean }) =>
  partial ? <Badge tone="warning">Partial</Badge> : stale ? <Badge tone="warning">Stale</Badge> : null;

function Summary({ data }: { data: Data }) {
  const sumGroup = (group: string) => add('0', ...data.current.accounts.filter((a) => a.group === group && a.aud).map((a) => a.aud!));
  const previous = data.flows.slice(0, -1);
  const average = (key: 'income' | 'outflow' | 'net') =>
    previous.length ? previous.reduce((s, f) => s + Number(f[key]), 0) / previous.length : null;
  const vs = (key: 'income' | 'outflow' | 'net') => {
    const avg = average(key);
    return avg === null ? undefined : `avg ${moneyNumber(avg)} over previous ${previous.length}`;
  };
  const t = data.totals;
  return (
    <section className="mb-6">
      <div className="mb-3 grid grid-cols-2 gap-3 md:grid-cols-5">
        <Tile
          label="Net worth"
          value={money(data.current.netWorth)}
          tone={data.current.netWorth.startsWith('-') ? 'negative' : undefined}
          badge={<QualityBadge partial={data.current.partial} stale={data.current.stale} />}
          sub={`today, ${shortDate(data.current.on)}`}
        />
        <Tile label="Assets" value={money(data.current.assets)} />
        <Tile label="Liabilities" value={money(data.current.liabilities)} />
        <Tile label="Cash" value={money(sumGroup('Cash'))} />
        <Tile label="Investments" value={money(sumGroup('Investments'))} />
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Tile label={`Income · ${data.selected.label}`} value={money(t.income)} sub={vs('income')} />
        <Tile label="Spending" value={money(t.spending)} sub="Essentials + Lifestyle" />
        <Tile label="Saved" value={money(t.saved)} sub="Savings legs" />
        <Tile
          label="Net cash flow"
          value={money(t.netCashFlow)}
          tone={t.netCashFlow.startsWith('-') ? 'negative' : undefined}
          sub={vs('net')}
        />
      </div>
      {(data.fx.unconverted > 0 || data.fx.staleConverted > 0) && (
        <p className="text-warning mt-2 text-xs">
          {data.fx.unconverted > 0 && `${data.fx.unconverted} foreign-currency legs have no FX rate and are left out. `}
          {data.fx.staleConverted > 0 && `${data.fx.staleConverted} used a stale or trade-only rate. `}
          <Link to="/prices" className="underline">
            Add FX rates
          </Link>
        </p>
      )}
    </section>
  );
}

function NetWorthSection({ data }: { data: Data }) {
  const flags = data.netWorth.map((p) => p.partial || p.stale);
  const series: PeriodSeries[] = [
    {
      key: 'netWorth',
      label: 'Net worth',
      color: 'var(--series-1)',
      type: 'line',
      values: data.netWorth.map((p) => Number(p.netWorth)),
      hollow: flags,
    },
    {
      key: 'assets',
      label: 'Assets',
      color: 'var(--series-2)',
      type: 'line',
      values: data.netWorth.map((p) => Number(p.assets)),
      hollow: flags,
    },
    {
      key: 'liabilities',
      label: 'Liabilities',
      color: 'var(--series-3)',
      type: 'line',
      values: data.netWorth.map((p) => Number(p.liabilities)),
      hollow: flags,
    },
  ];
  return (
    <Card className="mb-6 p-4">
      <h2 className="mb-1 text-sm font-medium">Net worth</h2>
      <p className="text-muted mb-3 text-xs">At the end of each period. Open markers are partial or stale: hover for why.</p>
      <PeriodChart
        ariaLabel="Net worth, assets and liabilities by period"
        labels={data.netWorth.map((p) => p.label)}
        series={series}
        formatAxis={compact}
        formatValue={moneyNumber}
        notes={data.netWorth.map((p) => [
          ...(p.partial ? ['Partial: some values unavailable'] : []),
          ...(p.stale ? ['Stale values included'] : []),
          ...p.notes.slice(0, 4),
        ])}
      />
    </Card>
  );
}

function CashFlowSection({ data }: { data: Data }) {
  const series: PeriodSeries[] = [
    { key: 'income', label: 'Income', color: 'var(--series-1)', type: 'bar', values: data.flows.map((f) => Number(f.income)) },
    { key: 'outflow', label: 'Outflows', color: 'var(--series-2)', type: 'bar', values: data.flows.map((f) => Number(f.outflow)) },
    { key: 'net', label: 'Net cash flow', color: 'var(--series-3)', type: 'line', values: data.flows.map((f) => Number(f.net)) },
  ];
  return (
    <div className="mb-6 flex flex-col gap-6">
      <Card className="p-4">
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className="text-sm font-medium">Cash flow · {data.selected.label}</h2>
          <Link to="/cash-flow" search={{ from: data.selected.from, to: data.selected.to }} className="text-accent text-xs underline">
            Open
          </Link>
        </div>
        {data.sankey.links.length ? (
          <SankeyChart nodes={data.sankey.nodes} links={data.sankey.links} onSelect={() => {}} />
        ) : (
          <Empty>No cash flow in this period.</Empty>
        )}
      </Card>
      <Card className="p-4">
        <h2 className="mb-3 text-sm font-medium">Income and outflows by period</h2>
        <PeriodChart
          ariaLabel="Income and outflows by period with net cash flow"
          labels={data.flows.map((f) => f.label)}
          series={series}
          formatAxis={compact}
          formatValue={moneyNumber}
        />
      </Card>
    </div>
  );
}

function ExpensesSection({ data, onFocus }: { data: Data; onFocus: (focus: string | undefined) => void }) {
  const { segments, periods, focus } = data.expenses;
  const series: PeriodSeries[] = segments.slice(0, 8).map((s, i) => ({
    key: s.id,
    label: s.name,
    color: s.id === 'uncategorised' ? 'var(--series-neutral)' : focus ? SLOTS[i]! : (ROOT_COLORS[s.name] ?? SLOTS[i]!),
    type: 'bar',
    stack: 'spending',
    values: periods.map((p) => toNumber(p.segments[s.id]) ?? 0),
  }));
  // More than eight segments fold into "Other" rather than generating new colours.
  if (segments.length > 8) {
    series.push({
      key: 'other',
      label: 'Other',
      color: 'var(--series-neutral)',
      type: 'bar',
      stack: 'spending',
      values: periods.map((p) => segments.slice(8).reduce((sum, s) => sum + (toNumber(p.segments[s.id]) ?? 0), 0)),
    });
  }
  return (
    <Card className="mb-6 p-4">
      <div className="mb-3 flex flex-wrap items-baseline gap-2">
        <h2 className="text-sm font-medium">Expenses by category</h2>
        {focus && (
          <span className="text-xs">
            <button className="text-accent underline" onClick={() => onFocus(undefined)}>
              All expenses
            </button>
            <span className="text-muted"> › {focus.name}</span>
          </span>
        )}
        <span className="text-muted text-xs">Click a category to drill in.</span>
      </div>
      {series.length === 0 ? (
        <Empty>No spending in these periods.</Empty>
      ) : (
        <PeriodChart
          ariaLabel="Expenses by category per period"
          labels={periods.map((p) => p.label)}
          series={series}
          formatAxis={compact}
          formatValue={moneyNumber}
          selectable={segments.filter((s) => s.drillable).map((s) => s.id)}
          onSelect={(id) => onFocus(id)}
        />
      )}
    </Card>
  );
}

function AccountsSection({ data }: { data: Data }) {
  const groups = Map.groupBy(data.current.accounts, (a) => a.group);
  return (
    <Card className="p-4">
      <h2 className="mb-3 text-sm font-medium">Accounts today</h2>
      {[...groups].map(([group, accounts]) => (
        <div key={group} className="mb-3">
          <h3 className="text-muted mb-1 text-xs font-medium">{group}</h3>
          {accounts.map((a) => (
            <div key={a.id} className="flex flex-wrap items-baseline gap-x-3 py-0.5 text-sm">
              <span className="flex-1">
                {a.name} <span className="text-muted text-xs">{a.institution}</span>
              </span>
              {a.status !== 'ok' && (
                <span title={a.notes.join('\n')}>
                  <Badge tone={a.status === 'stale' ? 'warning' : 'negative'}>{a.status === 'missing' ? 'No price/rate' : a.status}</Badge>
                </span>
              )}
              {a.overrideValue && (
                <span title="Display only: uses your override price or rate and is not in any total">
                  <Badge>Override {money(a.overrideValue)}</Badge>
                </span>
              )}
              <span className="tabular w-32 text-right">{a.aud ? money(a.aud) : '—'}</span>
              {a.notes.length > 0 && <span className="text-muted w-full text-xs">{a.notes.join(' · ')}</span>}
            </div>
          ))}
        </div>
      ))}
    </Card>
  );
}

function RecentEvents({ data }: { data: Data }) {
  return (
    <Card className="p-4">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-sm font-medium">Recent events</h2>
        <Link to="/events" search={{ page: 0 }} className="text-accent text-xs underline">
          All events
        </Link>
      </div>
      {data.recent.map((e) => (
        <div key={e.id} className="flex flex-wrap gap-x-3 py-0.5 text-sm">
          <span className="text-muted tabular w-24">{shortDate(e.occurredOn)}</span>
          <span className="min-w-0 flex-1 truncate">{e.description}</span>
          <span className="text-muted text-xs">{e.status === 'unmatched_transfer' ? 'unmatched transfer' : e.type.replace('_', ' ')}</span>
        </div>
      ))}
    </Card>
  );
}
