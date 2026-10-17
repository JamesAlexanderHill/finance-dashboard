import { keepPreviousData, useQuery, useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { z } from 'zod';
import type { DateRange } from '@finance/shared';
import {
  categoriesQuery,
  ChartCard,
  compact,
  compareRange,
  DashboardHeader,
  defaultResolution,
  flowQuery,
  Loading,
  moneyNumber,
  netWorthQuery,
  num,
  pageRange,
  periodSearch,
  ResolutionControl,
  resolutionParam,
  Segmented,
  summaryQuery,
  type FlowData,
  type Resolution,
} from '../../components/dashboard';
import { PeriodChart, type PeriodSeries } from '../../components/period-chart';
import { Badge, Card, Empty } from '../../components/ui';
import { money, shortDate } from '../../lib/format';
import type { getDashboardSummary } from '../../server/dashboard.functions';

const searchSchema = z.object({
  ...periodSearch,
  // Each chart keeps its own resolution.
  nwRes: resolutionParam,
  nwMode: z.enum(['split', 'net']).optional(),
  catRes: resolutionParam,
  focus: z.uuid().optional(),
  flowRes: resolutionParam,
});
type Search = z.infer<typeof searchSchema>;

export const Route = createFileRoute('/_app/')({
  validateSearch: searchSchema,
  loaderDeps: ({ search }) => search,
  loader: ({ context: { queryClient }, deps }) => {
    const r = pageRange(deps);
    const c = compareRange(deps);
    const res = (key?: Resolution) => key ?? defaultResolution(r);
    const tags = deps.tags ?? [];
    return Promise.all([
      queryClient.ensureQueryData(categoriesQuery),
      queryClient.ensureQueryData(summaryQuery(r, c, tags)),
      queryClient.ensureQueryData(netWorthQuery(r, res(deps.nwRes))),
      queryClient.ensureQueryData(flowQuery(r, c, res(deps.catRes), tags, deps.focus ?? null)),
      queryClient.ensureQueryData(flowQuery(r, c, res(deps.flowRes), tags, null)),
    ]);
  },
  component: Dashboard,
});

/** Top-level categories keep the colours the Sankey uses; drilled-in children take slots in order. */
const ROOT_COLORS: Record<string, string> = { Savings: 'var(--series-2)', Essentials: 'var(--series-3)', Lifestyle: 'var(--series-4)' };
const SLOTS = [1, 2, 3, 4, 5, 6, 7, 8].map((i) => `var(--series-${i})`);

/** Chart resolutions reset when the page period changes, so each falls back to a sensible default. */
const RESET_RESOLUTIONS = { nwRes: undefined, catRes: undefined, flowRes: undefined } as const;

function Dashboard() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const set = (patch: Partial<Search>) => navigate({ search: (prev) => ({ ...prev, ...patch }), resetScroll: false });
  const range = pageRange(search);
  const compared = compareRange(search);
  const tags = search.tags ?? [];
  const { data: summary } = useSuspenseQuery(summaryQuery(range, compared, tags));
  const res = (key?: Resolution) => key ?? defaultResolution(range);

  return (
    <>
      <DashboardHeader
        title="Dashboard"
        description={`${summary.range.label}, compared with ${summary.previous.label}`}
        search={search}
        set={set}
        reset={RESET_RESOLUTIONS}
      />
      <Summary data={summary} />
      <NetWorthSection
        range={range}
        resolution={res(search.nwRes)}
        mode={search.nwMode ?? 'split'}
        onChange={(p) => set({ nwRes: p.resolution, nwMode: p.mode === 'split' ? undefined : p.mode })}
      />
      <CategorySection
        range={range}
        compared={compared}
        tags={tags}
        resolution={res(search.catRes)}
        focus={search.focus ?? null}
        onChange={(p) => set({ catRes: p.resolution, focus: p.focus })}
      />
      <IncomeExpensesSection
        range={range}
        compared={compared}
        tags={tags}
        resolution={res(search.flowRes)}
        onChange={(flowRes) => set({ flowRes })}
      />
    </>
  );
}

// ---- Summary ----

type SummaryData = Awaited<ReturnType<typeof getDashboardSummary>>;

/** A change between two amounts, as an arrow, amount and percentage; `good` says which direction reads well. */
function Change({ now, before, good, suffix }: { now: number; before: number; good: 'up' | 'down'; suffix: string }) {
  const diff = now - before;
  if (Math.abs(diff) < 0.005) return <span className="text-muted">No change {suffix}</span>;
  const up = diff > 0;
  const pct = before !== 0 ? ` (${up ? '+' : ''}${Math.round((diff / Math.abs(before)) * 100)}%)` : '';
  return (
    <span className={up === (good === 'up') ? 'text-positive' : 'text-negative'}>
      {up ? '▲' : '▼'} {moneyNumber(Math.abs(diff))}
      {pct} <span className="text-muted">{suffix}</span>
    </span>
  );
}

function Tile({
  label,
  value,
  sub,
  badge,
  negative,
}: {
  label: string;
  value: string;
  sub?: ReactNode;
  badge?: ReactNode;
  negative?: boolean;
}) {
  return (
    <Card className="p-3">
      <div className="text-muted flex items-center gap-2 text-xs">
        {label} {badge}
      </div>
      <div className={`tabular text-lg font-semibold ${negative ? 'text-negative' : ''}`}>{value}</div>
      {sub && <div className="text-xs">{sub}</div>}
    </Card>
  );
}

const QualityBadge = ({ partial, stale }: { partial: boolean; stale: boolean }) =>
  partial ? <Badge tone="warning">Partial</Badge> : stale ? <Badge tone="warning">Stale</Badge> : null;

function Summary({ data }: { data: SummaryData }) {
  const { start, end } = data.netWorth;
  const now = data.flows.current;
  const before = data.flows.previous;
  const vsPrev = `vs ${data.previous.label}`;
  const rate = (f: typeof now) => (Number(f.income) > 0 ? (Number(f.net) / Number(f.income)) * 100 : null);
  const [rateNow, ratePrev] = [rate(now), rate(before)];
  return (
    <section className="mb-6" aria-label="Summary">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Tile
          label={`Net worth · ${shortDate(end.on)}`}
          value={money(end.netWorth)}
          negative={end.netWorth.startsWith('-')}
          badge={<QualityBadge partial={end.partial} stale={end.stale} />}
          sub={<Change now={Number(end.netWorth)} before={Number(start.netWorth)} good="up" suffix="this period" />}
        />
        <Tile
          label="Assets"
          value={money(end.assets)}
          sub={<Change now={Number(end.assets)} before={Number(start.assets)} good="up" suffix="this period" />}
        />
        <Tile
          label="Liabilities"
          value={money(end.liabilities)}
          sub={<Change now={Number(end.liabilities)} before={Number(start.liabilities)} good="down" suffix="this period" />}
        />
        <Tile
          label="Top spending category"
          value={data.topCategory ? data.topCategory.name : '—'}
          sub={
            data.topCategory ? (
              <span>
                <span className="tabular">{money(data.topCategory.amount)}</span>{' '}
                <Change now={Number(data.topCategory.amount)} before={Number(data.topCategory.previous)} good="down" suffix="" />
              </span>
            ) : (
              <span className="text-muted">No spending</span>
            )
          }
        />
        <Tile
          label="Income"
          value={money(now.income)}
          sub={<Change now={Number(now.income)} before={Number(before.income)} good="up" suffix={vsPrev} />}
        />
        <Tile
          label="Expenses"
          value={money(now.expenses)}
          sub={<Change now={Number(now.expenses)} before={Number(before.expenses)} good="down" suffix={vsPrev} />}
        />
        <Tile
          label="Net cash flow"
          value={money(now.net)}
          negative={now.net.startsWith('-')}
          sub={<Change now={Number(now.net)} before={Number(before.net)} good="up" suffix={vsPrev} />}
        />
        <Tile
          label="Savings rate"
          value={rateNow === null ? '—' : `${rateNow.toFixed(0)}%`}
          negative={rateNow !== null && rateNow < 0}
          sub={
            <span className="text-muted">
              {ratePrev === null ? 'No income' : `${ratePrev.toFixed(0)}%`} {vsPrev} · spending {money(now.spending)}
            </span>
          }
        />
      </div>
      {(data.fx.unconverted > 0 || data.fx.staleConverted > 0) && (
        <p className="text-warning mt-2 text-xs">
          {data.fx.unconverted > 0 && `${data.fx.unconverted} foreign-currency legs have no FX rate and are left out. `}
          {data.fx.staleConverted > 0 && `${data.fx.staleConverted} used a stale or trade-only rate. `}
          <Link to="/accounts/assets/prices" className="underline">
            Add FX rates
          </Link>
        </p>
      )}
    </section>
  );
}

// ---- Net worth ----

/** Account groups in stacking order, each with a fixed colour; liabilities stack below the line. */
const NET_WORTH_GROUPS = [
  { name: 'Cash', color: 'var(--series-1)', liability: false },
  { name: 'Investments', color: 'var(--series-7)', liability: false },
  { name: 'Property & other', color: 'var(--series-3)', liability: false },
  { name: 'Loans', color: 'var(--series-2)', liability: true },
  { name: 'Credit cards', color: 'var(--series-8)', liability: true },
  { name: 'Other liabilities', color: 'var(--series-4)', liability: true },
] as const;

function NetWorthSection(props: {
  range: DateRange;
  resolution: Resolution;
  mode: 'split' | 'net';
  onChange: (p: { resolution: Resolution; mode: 'split' | 'net' }) => void;
}) {
  const { data, isPlaceholderData } = useQuery({ ...netWorthQuery(props.range, props.resolution), placeholderData: keepPreviousData });
  const mode = props.mode;
  const resolution = data?.resolution ?? props.resolution;

  let body: ReactNode = <Loading />;
  if (data) {
    const points = data.current.map((p) => p.value);
    const series: PeriodSeries[] = [];
    // Split stacks assets by group above the line and liabilities below; net is one area.
    if (mode === 'split') {
      for (const g of NET_WORTH_GROUPS) {
        const values = points.map((v) => (v ? (num(v.groups[g.name]) ?? 0) * (g.liability ? -1 : 1) : null));
        if (values.some((v) => v)) series.push({ key: g.name, label: g.name, color: g.color, type: 'area', stack: 'nw', values });
      }
    } else {
      series.push({
        key: 'netArea',
        label: 'Net worth',
        color: 'var(--series-1)',
        type: 'area',
        values: points.map((v) => num(v?.netWorth)),
      });
    }
    series.push({
      key: 'netWorth',
      label: 'Net worth',
      color: mode === 'split' ? 'var(--text)' : 'var(--series-1)',
      unlisted: mode === 'net',
      type: 'line',
      values: points.map((v) => num(v?.netWorth)),
      hollow: points.map((v) => !!v && (v.partial || v.stale)),
    });
    body = (
      <PeriodChart
        ariaLabel="Net worth by period"
        labels={data.current.map((p) => p.label)}
        series={series}
        formatAxis={compact}
        formatValue={moneyNumber}
        notes={points.map((v) =>
          v
            ? [
                ...(v.partial ? ['Partial: some values unavailable'] : []),
                ...(v.stale ? ['Stale values included'] : []),
                ...v.notes.slice(0, 4),
              ]
            : [],
        )}
      />
    );
  }
  return (
    <ChartCard
      title="Net worth"
      description={`At the end of each ${resolution}. ${
        mode === 'split' ? 'Assets by group above the line, liabilities below. ' : ''
      }Open markers are partial or stale: hover for why.`}
      loading={isPlaceholderData}
      controls={
        <>
          <Segmented
            label="View"
            options={['split', 'net'] as const}
            value={mode}
            onChange={(m) => props.onChange({ resolution, mode: m })}
          />
          <ResolutionControl range={props.range} value={resolution} onChange={(r) => props.onChange({ resolution: r, mode })} />
        </>
      }
    >
      {body}
    </ChartCard>
  );
}

// ---- Flow-based charts ----

function useFlows(range: DateRange, compared: DateRange, resolution: Resolution, tags: string[], focus: string | null = null) {
  return useQuery({ ...flowQuery(range, compared, resolution, tags, focus), placeholderData: keepPreviousData });
}

function CategorySection(props: {
  range: DateRange;
  compared: DateRange;
  tags: string[];
  resolution: Resolution;
  focus: string | null;
  onChange: (p: { resolution: Resolution; focus: string | undefined }) => void;
}) {
  const { data, isPlaceholderData } = useFlows(props.range, props.compared, props.resolution, props.tags, props.focus);
  const resolution = data?.resolution ?? props.resolution;
  const setFocus = (focus: string | undefined) => props.onChange({ resolution, focus });

  let body: ReactNode = <Loading />;
  if (data) {
    const { segments, current, focus } = data;
    const value = (b: FlowData['current'][number], id: string) => (b.future ? null : (num(b.segments[id]) ?? 0));
    const series: PeriodSeries[] = segments.slice(0, 8).map((s, i) => ({
      key: s.id,
      label: s.name,
      color: s.id === 'uncategorised' ? 'var(--series-neutral)' : focus ? SLOTS[i]! : (ROOT_COLORS[s.name] ?? SLOTS[i]!),
      type: 'bar',
      stack: 'spending',
      values: current.map((b) => value(b, s.id)),
    }));
    // More than eight segments fold into "Other" rather than generating new colours.
    if (segments.length > 8) {
      series.push({
        key: 'other',
        label: 'Other',
        color: 'var(--series-neutral)',
        type: 'bar',
        stack: 'spending',
        values: current.map((b) => (b.future ? null : segments.slice(8).reduce((sum, s) => sum + (num(b.segments[s.id]) ?? 0), 0))),
      });
    }
    body =
      segments.length === 0 ? (
        <Empty>No spending in this period.</Empty>
      ) : (
        <PeriodChart
          ariaLabel="Expenses by category"
          labels={current.map((b) => b.label)}
          series={series}
          formatAxis={compact}
          formatValue={moneyNumber}
          selectable={segments.filter((s) => s.drillable).map((s) => s.id)}
          onSelect={setFocus}
        />
      );
  }
  return (
    <ChartCard
      title={
        <span className="flex flex-wrap items-baseline gap-2">
          Expenses by category
          {data?.focus && (
            <span className="text-xs font-normal">
              <button className="text-accent underline" onClick={() => setFocus(undefined)}>
                All expenses
              </button>
              <span className="text-muted"> › {data.focus.name}</span>
            </span>
          )}
        </span>
      }
      description="Click a category to drill in."
      loading={isPlaceholderData}
      controls={
        <ResolutionControl
          range={props.range}
          value={resolution}
          onChange={(r) => props.onChange({ resolution: r, focus: props.focus ?? undefined })}
        />
      }
    >
      {body}
    </ChartCard>
  );
}

function IncomeExpensesSection(props: {
  range: DateRange;
  compared: DateRange;
  tags: string[];
  resolution: Resolution;
  onChange: (r: Resolution) => void;
}) {
  const { data, isPlaceholderData } = useFlows(props.range, props.compared, props.resolution, props.tags);
  let body: ReactNode = <Loading />;
  if (data) {
    const at = (key: 'income' | 'expenses') => data.current.map((b) => (b.future ? null : Number(b[key])));
    body = (
      <PeriodChart
        ariaLabel="Income and expenses"
        labels={data.current.map((b) => b.label)}
        series={[
          { key: 'income', label: 'Income', color: 'var(--series-1)', type: 'bar', values: at('income') },
          { key: 'expenses', label: 'Expenses', color: 'var(--series-2)', type: 'bar', values: at('expenses') },
        ]}
        formatAxis={compact}
        formatValue={moneyNumber}
      />
    );
  }
  return (
    <ChartCard
      title="Income and expenses"
      loading={isPlaceholderData}
      controls={<ResolutionControl range={props.range} value={data?.resolution ?? props.resolution} onChange={props.onChange} />}
    >
      {body}
    </ChartCard>
  );
}
