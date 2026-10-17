import { keepPreviousData, queryOptions, useQuery, useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { z } from 'zod';
import { daysBetween, presetRange, RANGE_PRESETS, shiftRange, todayIso, type DateRange } from '@finance/shared';
import { PeriodChart, type PeriodSeries } from '../../components/period-chart';
import { Badge, Button, Card, Empty, PageHeader } from '../../components/ui';
import { money, shortDate } from '../../lib/format';
import { listCategories } from '../../server/categories.functions';
import { getDashboardSummary, getFlowSeries, getNetWorthSeries } from '../../server/dashboard.functions';

const RESOLUTIONS = ['day', 'week', 'month', 'quarter', 'year'] as const;
type Resolution = (typeof RESOLUTIONS)[number];
const resolution = z.enum(RESOLUTIONS).optional();

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const searchSchema = z.object({
  /** The page period: a preset relative to today, or `custom` with from/to. */
  preset: z.enum(['custom', ...RANGE_PRESETS.map((p) => p.id)] as ['custom', ...Preset[]]).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  tags: z.array(z.uuid()).optional(),
  // Each chart keeps its own resolution and compare toggle.
  nwRes: resolution,
  nwCmp: z.boolean().optional(),
  nwMode: z.enum(['split', 'net']).optional(),
  cumRes: resolution,
  cumCmp: z.boolean().optional(),
  catRes: resolution,
  catCmp: z.boolean().optional(),
  focus: z.uuid().optional(),
  flowRes: resolution,
  flowCmp: z.boolean().optional(),
});
type Search = z.infer<typeof searchSchema>;
type Preset = (typeof RANGE_PRESETS)[number]['id'];

/** The page period the search names; defaults to this month. */
function pageRange(s: Search): DateRange {
  if (s.preset === 'custom' && s.from && s.to) return s.from <= s.to ? { from: s.from, to: s.to } : { from: s.to, to: s.from };
  return presetRange(s.preset && s.preset !== 'custom' ? s.preset : 'this-month', todayIso());
}

/** Approximate days per bucket, to pick a default resolution and rule out ones with too many buckets. */
const BUCKET_DAYS: Record<Resolution, number> = { day: 1, week: 7, month: 30.4, quarter: 91, year: 365 };
const MAX_BUCKETS = 400;
const span = (r: DateRange) => daysBetween(r.from, r.to) + 1;
function defaultResolution(r: DateRange): Resolution {
  const days = span(r);
  return days <= 31 ? 'day' : days <= 120 ? 'week' : days <= 1100 ? 'month' : days <= 3000 ? 'quarter' : 'year';
}

const summaryQuery = (r: DateRange, tagIds: string[]) =>
  queryOptions({
    queryKey: ['dashboard', 'summary', r, tagIds],
    queryFn: () => getDashboardSummary({ data: { ...r, tagIds } }),
  });
const netWorthQuery = (r: DateRange, res: Resolution) =>
  queryOptions({
    queryKey: ['dashboard', 'net-worth', r, res],
    queryFn: () => getNetWorthSeries({ data: { ...r, resolution: res, tagIds: [], expenseFocus: null } }),
  });
const flowQuery = (r: DateRange, res: Resolution, tagIds: string[], focus: string | null) =>
  queryOptions({
    queryKey: ['dashboard', 'flows', r, res, tagIds, focus],
    queryFn: () => getFlowSeries({ data: { ...r, resolution: res, tagIds, expenseFocus: focus } }),
  });
const categoriesQuery = queryOptions({ queryKey: ['categories'], queryFn: () => listCategories() });

export const Route = createFileRoute('/_app/')({
  validateSearch: searchSchema,
  loaderDeps: ({ search }) => search,
  loader: ({ context: { queryClient }, deps }) => {
    const r = pageRange(deps);
    const res = (key?: Resolution) => key ?? defaultResolution(r);
    const tags = deps.tags ?? [];
    return Promise.all([
      queryClient.ensureQueryData(categoriesQuery),
      queryClient.ensureQueryData(summaryQuery(r, tags)),
      queryClient.ensureQueryData(netWorthQuery(r, res(deps.nwRes))),
      queryClient.ensureQueryData(flowQuery(r, res(deps.cumRes), tags, null)),
      queryClient.ensureQueryData(flowQuery(r, res(deps.catRes), tags, deps.focus ?? null)),
      queryClient.ensureQueryData(flowQuery(r, res(deps.flowRes), tags, null)),
    ]);
  },
  component: Dashboard,
});

const compact = (n: number) => {
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}m`;
  if (abs >= 1000) return `${sign}$${(abs / 1000).toFixed(abs >= 10_000 ? 0 : 1)}k`;
  return `${sign}$${abs.toFixed(0)}`;
};
const moneyNumber = (n: number) => money(n.toFixed(2));
const num = (v: string | null | undefined) => (v == null ? null : Number(v));

/** Top-level categories keep the colours the Sankey uses; drilled-in children take slots in order. */
const ROOT_COLORS: Record<string, string> = { Savings: 'var(--series-2)', Essentials: 'var(--series-3)', Lifestyle: 'var(--series-4)' };
const SLOTS = [1, 2, 3, 4, 5, 6, 7, 8].map((i) => `var(--series-${i})`);

/** Chart resolutions reset when the page period changes, so each falls back to a sensible default. */
const RESET_RESOLUTIONS = { nwRes: undefined, cumRes: undefined, catRes: undefined, flowRes: undefined } as const;

function Dashboard() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const set = (patch: Partial<Search>) => navigate({ search: (prev) => ({ ...prev, ...patch }), resetScroll: false });
  const range = pageRange(search);
  const tags = search.tags ?? [];
  const { data: summary } = useSuspenseQuery(summaryQuery(range, tags));
  const { data: cats } = useSuspenseQuery(categoriesQuery);
  const res = (key?: Resolution) => key ?? defaultResolution(range);
  const setRange = (r: DateRange) => set({ preset: 'custom', from: r.from, to: r.to, ...RESET_RESOLUTIONS });

  return (
    <>
      <PageHeader title="Dashboard" description={`${summary.range.label}, compared with ${summary.previous.label}`} />

      {/* The page period drives every section below. */}
      <Card className="mb-6 flex flex-col gap-3 p-3 text-sm">
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Period">
          {RANGE_PRESETS.map((p) => {
            const on = (search.preset ?? 'this-month') === p.id;
            return (
              <button
                key={p.id}
                onClick={() => set({ preset: p.id, from: undefined, to: undefined, ...RESET_RESOLUTIONS })}
                className={`rounded-full border px-2.5 py-0.5 text-xs ${on ? 'border-accent bg-accent text-accent-ink' : 'border-line bg-surface'}`}
                aria-pressed={on}
              >
                {p.label}
              </button>
            );
          })}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={() => setRange(shiftRange(range, -1))} aria-label="Previous period">
            ←
          </Button>
          <input
            type="date"
            value={range.from}
            max={range.to}
            onChange={(e) => e.target.value && setRange({ from: e.target.value, to: range.to })}
            className="border-line bg-surface rounded border px-2 py-1"
            aria-label="From"
          />
          <span className="text-muted">to</span>
          <input
            type="date"
            value={range.to}
            min={range.from}
            onChange={(e) => e.target.value && setRange({ from: range.from, to: e.target.value })}
            className="border-line bg-surface rounded border px-2 py-1"
            aria-label="To"
          />
          <Button onClick={() => setRange(shiftRange(range, 1))} disabled={shiftRange(range, 1).from > todayIso()} aria-label="Next period">
            →
          </Button>
          <span className="text-muted text-xs">Compare: {summary.previous.label}</span>
          {cats.tags.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 sm:ml-auto">
              <span className="text-muted">Tags</span>
              {cats.tags.map((tag) => {
                const on = tags.includes(tag.id);
                const next = on ? tags.filter((t) => t !== tag.id) : [...tags, tag.id];
                return (
                  <button
                    key={tag.id}
                    onClick={() => set({ tags: next.length ? next : undefined })}
                    className={`rounded-full border px-2 py-0.5 text-xs ${on ? 'border-accent bg-accent text-accent-ink' : 'border-line bg-surface'}`}
                    aria-pressed={on}
                  >
                    {tag.name}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </Card>

      <Summary data={summary} />
      <NetWorthSection
        range={range}
        resolution={res(search.nwRes)}
        compare={search.nwCmp ?? false}
        mode={search.nwMode ?? 'split'}
        onChange={(p) => set({ nwRes: p.resolution, nwCmp: p.compare, nwMode: p.mode })}
      />
      <CumulativeExpensesSection
        range={range}
        tags={tags}
        resolution={res(search.cumRes)}
        compare={search.cumCmp ?? false}
        onChange={(p) => set({ cumRes: p.resolution, cumCmp: p.compare })}
      />
      <CategorySection
        range={range}
        tags={tags}
        resolution={res(search.catRes)}
        compare={search.catCmp ?? false}
        focus={search.focus ?? null}
        onChange={(p) => set({ catRes: p.resolution, catCmp: p.compare, focus: p.focus })}
      />
      <IncomeExpensesSection
        range={range}
        tags={tags}
        resolution={res(search.flowRes)}
        compare={search.flowCmp ?? false}
        onChange={(p) => set({ flowRes: p.resolution, flowCmp: p.compare })}
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
          <Link to="/assets/prices" className="underline">
            Add FX rates
          </Link>
        </p>
      )}
    </section>
  );
}

// ---- Chart frame ----

function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
  disabled,
}: {
  label: string;
  options: readonly T[];
  value: T;
  onChange: (v: T) => void;
  disabled?: (v: T) => boolean;
}) {
  return (
    <div className="border-line flex overflow-hidden rounded-md border text-xs" role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={o}
          onClick={() => onChange(o)}
          disabled={disabled?.(o)}
          aria-pressed={value === o}
          className={`px-2 py-0.5 capitalize disabled:opacity-40 ${value === o ? 'bg-accent text-accent-ink' : 'bg-surface'}`}
        >
          {o}
        </button>
      ))}
    </div>
  );
}

function CompareToggle({ on, onChange, label }: { on: boolean; onChange: (on: boolean) => void; label: string }) {
  return (
    <label className="flex cursor-pointer items-center gap-1.5 text-xs">
      <input type="checkbox" checked={on} onChange={(e) => onChange(e.target.checked)} />
      Compare with {label}
    </label>
  );
}

/** A dashboard chart card: title, its own controls and a body that dims while new data loads. */
function ChartCard({
  title,
  description,
  controls,
  loading,
  children,
}: {
  title: ReactNode;
  description?: ReactNode;
  controls?: ReactNode;
  loading?: boolean;
  children: ReactNode;
}) {
  return (
    <Card className="mb-6 p-4">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-medium">{title}</h2>
          {description && <p className="text-muted text-xs">{description}</p>}
        </div>
        {controls && <div className="flex flex-wrap items-center gap-3">{controls}</div>}
      </div>
      <div className={loading ? 'opacity-60 transition-opacity' : 'transition-opacity'}>{children}</div>
    </Card>
  );
}

/** Resolution and compare controls shared by every time-series chart. */
function SeriesControls({
  range,
  resolution,
  compare,
  previousLabel,
  onChange,
  children,
}: {
  range: DateRange;
  resolution: Resolution;
  compare: boolean;
  previousLabel: string;
  onChange: (p: { resolution: Resolution; compare: boolean | undefined }) => void;
  children?: ReactNode;
}) {
  return (
    <>
      {children}
      <Segmented
        label="Resolution"
        options={RESOLUTIONS}
        value={resolution}
        disabled={(r) => span(range) / BUCKET_DAYS[r] > MAX_BUCKETS}
        onChange={(r) => onChange({ resolution: r, compare: compare || undefined })}
      />
      <CompareToggle on={compare} label={previousLabel} onChange={(c) => onChange({ resolution, compare: c || undefined })} />
    </>
  );
}

const Loading = () => <Empty>Loading…</Empty>;

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
  compare: boolean;
  mode: 'split' | 'net';
  onChange: (p: { resolution: Resolution; compare: boolean | undefined; mode: 'split' | 'net' | undefined }) => void;
}) {
  const { data, isPlaceholderData } = useQuery({ ...netWorthQuery(props.range, props.resolution), placeholderData: keepPreviousData });
  const mode = props.mode;
  const change = (p: Partial<{ resolution: Resolution; compare: boolean | undefined; mode: 'split' | 'net' }>) =>
    props.onChange({
      resolution: p.resolution ?? props.resolution,
      compare: 'compare' in p ? p.compare : props.compare || undefined,
      mode: (p.mode ?? mode) === 'split' ? undefined : 'net',
    });

  let body: ReactNode = <Loading />;
  if (data) {
    const points = data.current.map((p) => p.value);
    const flags = points.map((v) => !!v && (v.partial || v.stale));
    const series: PeriodSeries[] = [];
    // Split stacks assets by group above the line and liabilities below; net is one area.
    const lineColor = mode === 'split' ? 'var(--text)' : 'var(--series-1)';
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
      color: lineColor,
      unlisted: mode === 'net',
      type: 'line',
      values: points.map((v) => num(v?.netWorth)),
      hollow: flags,
    });
    if (props.compare) {
      series.push({
        key: 'prevNetWorth',
        label: `Net worth · ${data.previous.label}`,
        color: lineColor,
        type: 'line',
        dashed: true,
        values: data.current.map((_, i) => num(data.prior[i]?.value?.netWorth)),
      });
    }
    body = (
      <PeriodChart
        ariaLabel="Net worth by period"
        labels={data.current.map((p) => p.label)}
        compareLabels={props.compare ? data.current.map((_, i) => data.prior[i]?.label) : undefined}
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
      description={`At the end of each ${data?.resolution ?? props.resolution}. ${
        mode === 'split' ? 'Assets by group above the line, liabilities below. ' : ''
      }Open markers are partial or stale: hover for why.`}
      loading={isPlaceholderData}
      controls={
        <SeriesControls
          range={props.range}
          resolution={data?.resolution ?? props.resolution}
          compare={props.compare}
          previousLabel={data?.previous.label ?? 'previous period'}
          onChange={(p) => change(p)}
        >
          <Segmented label="View" options={['split', 'net'] as const} value={mode} onChange={(m) => change({ mode: m })} />
        </SeriesControls>
      }
    >
      {body}
    </ChartCard>
  );
}

// ---- Flow-based charts ----

type FlowData = Awaited<ReturnType<typeof getFlowSeries>>;

function useFlows(range: DateRange, resolution: Resolution, tags: string[], focus: string | null = null) {
  return useQuery({ ...flowQuery(range, resolution, tags, focus), placeholderData: keepPreviousData });
}

const compareLabels = (data: FlowData, compare: boolean) => (compare ? data.current.map((_, i) => data.prior[i]?.label) : undefined);

/** Running totals, stopping at buckets that have not started yet. */
function cumulative(buckets: FlowData['current'], key: 'expenses' | 'income') {
  let total = 0;
  return buckets.map((b) => (b.future ? null : (total += Number(b[key]))));
}

function CumulativeExpensesSection(props: {
  range: DateRange;
  tags: string[];
  resolution: Resolution;
  compare: boolean;
  onChange: (p: { resolution: Resolution; compare: boolean | undefined }) => void;
}) {
  const { data, isPlaceholderData } = useFlows(props.range, props.resolution, props.tags);
  let body: ReactNode = <Loading />;
  if (data) {
    const series: PeriodSeries[] = [
      {
        key: 'expenses',
        label: 'Expenses to date',
        color: 'var(--series-2)',
        type: 'line',
        step: true,
        values: cumulative(data.current, 'expenses'),
      },
    ];
    if (props.compare) {
      const prior = cumulative(data.prior, 'expenses');
      series.push({
        key: 'prevExpenses',
        label: `Expenses to date · ${data.previous.label}`,
        color: 'var(--series-2)',
        type: 'line',
        step: true,
        dashed: true,
        values: data.current.map((_, i) => prior[i] ?? null),
      });
    }
    body = (
      <PeriodChart
        ariaLabel="Cumulative expenses"
        labels={data.current.map((b) => b.label)}
        compareLabels={compareLabels(data, props.compare)}
        series={series}
        formatAxis={compact}
        formatValue={moneyNumber}
      />
    );
  }
  return (
    <ChartCard
      title="Expenses over the period"
      description="Running total of every outflow, refunds netted off."
      loading={isPlaceholderData}
      controls={
        <SeriesControls
          range={props.range}
          resolution={data?.resolution ?? props.resolution}
          compare={props.compare}
          previousLabel={data?.previous.label ?? 'previous period'}
          onChange={props.onChange}
        />
      }
    >
      {body}
    </ChartCard>
  );
}

function CategorySection(props: {
  range: DateRange;
  tags: string[];
  resolution: Resolution;
  compare: boolean;
  focus: string | null;
  onChange: (p: { resolution: Resolution; compare: boolean | undefined; focus: string | undefined }) => void;
}) {
  const { data, isPlaceholderData } = useFlows(props.range, props.resolution, props.tags, props.focus);
  const change = (p: Partial<{ resolution: Resolution; compare: boolean | undefined; focus: string | undefined }>) =>
    props.onChange({
      resolution: p.resolution ?? props.resolution,
      compare: 'compare' in p ? p.compare : props.compare || undefined,
      focus: 'focus' in p ? p.focus : (props.focus ?? undefined),
    });

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
    if (props.compare) {
      series.push({
        key: 'prevTotal',
        label: `Total · ${data.previous.label}`,
        color: 'var(--text)',
        type: 'line',
        dashed: true,
        values: current.map((_, i) => num(data.prior[i]?.segmentTotal)),
      });
    }
    body =
      segments.length === 0 ? (
        <Empty>No spending in this period.</Empty>
      ) : (
        <PeriodChart
          ariaLabel="Expenses by category"
          labels={current.map((b) => b.label)}
          compareLabels={compareLabels(data, props.compare)}
          series={series}
          formatAxis={compact}
          formatValue={moneyNumber}
          selectable={segments.filter((s) => s.drillable).map((s) => s.id)}
          onSelect={(id) => change({ focus: id })}
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
              <button className="text-accent underline" onClick={() => change({ focus: undefined })}>
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
        <SeriesControls
          range={props.range}
          resolution={data?.resolution ?? props.resolution}
          compare={props.compare}
          previousLabel={data?.previous.label ?? 'previous period'}
          onChange={change}
        />
      }
    >
      {body}
    </ChartCard>
  );
}

function IncomeExpensesSection(props: {
  range: DateRange;
  tags: string[];
  resolution: Resolution;
  compare: boolean;
  onChange: (p: { resolution: Resolution; compare: boolean | undefined }) => void;
}) {
  const { data, isPlaceholderData } = useFlows(props.range, props.resolution, props.tags);
  let body: ReactNode = <Loading />;
  if (data) {
    const at = (key: 'income' | 'expenses') => data.current.map((b) => (b.future ? null : Number(b[key])));
    const series: PeriodSeries[] = [
      { key: 'income', label: 'Income', color: 'var(--series-1)', type: 'bar', values: at('income') },
      { key: 'expenses', label: 'Expenses', color: 'var(--series-2)', type: 'bar', values: at('expenses') },
    ];
    if (props.compare) {
      const prior = (key: 'income' | 'expenses') => data.current.map((_, i) => num(data.prior[i]?.[key]));
      series.push(
        {
          key: 'prevIncome',
          label: `Income · ${data.previous.label}`,
          color: 'var(--series-1)',
          type: 'line',
          dashed: true,
          values: prior('income'),
        },
        {
          key: 'prevExpenses',
          label: `Expenses · ${data.previous.label}`,
          color: 'var(--series-2)',
          type: 'line',
          dashed: true,
          values: prior('expenses'),
        },
      );
    }
    body = (
      <PeriodChart
        ariaLabel="Income and expenses"
        labels={data.current.map((b) => b.label)}
        compareLabels={compareLabels(data, props.compare)}
        series={series}
        formatAxis={compact}
        formatValue={moneyNumber}
      />
    );
  }
  return (
    <ChartCard
      title="Income and expenses"
      loading={isPlaceholderData}
      controls={
        <SeriesControls
          range={props.range}
          resolution={data?.resolution ?? props.resolution}
          compare={props.compare}
          previousLabel={data?.previous.label ?? 'previous period'}
          onChange={props.onChange}
        />
      }
    >
      {body}
    </ChartCard>
  );
}
