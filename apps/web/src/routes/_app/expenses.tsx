import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { z } from 'zod';
import { daysBetween, todayIso } from '@finance/shared';
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
  pageRange,
  periodSearch,
  ResolutionControl,
  resolutionParam,
  type FlowData,
} from '../../components/dashboard';
import { PeriodChart, type PeriodSeries } from '../../components/period-chart';
import { Card } from '../../components/ui';

const searchSchema = z.object({
  ...periodSearch,
  res: resolutionParam,
  /** Overlay the compared period. */
  compare: z.boolean().optional(),
});
type Search = z.infer<typeof searchSchema>;

export const Route = createFileRoute('/_app/expenses')({
  validateSearch: searchSchema,
  loaderDeps: ({ search }) => search,
  loader: ({ context: { queryClient }, deps }) => {
    const r = pageRange(deps);
    return Promise.all([
      queryClient.ensureQueryData(categoriesQuery),
      queryClient.ensureQueryData(flowQuery(r, compareRange(deps), deps.res ?? defaultResolution(r), deps.tags ?? [], null)),
    ]);
  },
  component: ExpensesPage,
});

/** Running totals, stopping at buckets that have not started yet. */
function cumulative(buckets: FlowData['current']) {
  let total = 0;
  return buckets.map((b) => (b.future ? null : (total += Number(b.expenses))));
}

function ExpensesPage() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const set = (patch: Partial<Search>) => navigate({ search: (prev) => ({ ...prev, ...patch }), resetScroll: false });
  const range = pageRange(search);
  const compared = compareRange(search);
  const tags = search.tags ?? [];
  const resolution = search.res ?? defaultResolution(range);
  // The loader fetches the first view; a new resolution keeps the old chart until its data arrives.
  const { data, isPlaceholderData } = useQuery({
    ...flowQuery(range, compared, resolution, tags, null),
    placeholderData: keepPreviousData,
  });

  let body: ReactNode = <Loading />;
  let tiles: ReactNode = null;
  if (data) {
    const current = cumulative(data.current);
    const prior = cumulative(data.prior);
    const series: PeriodSeries[] = [
      { key: 'expenses', label: 'Expenses to date', color: 'var(--series-2)', type: 'line', step: true, values: current },
    ];
    if (search.compare) {
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
        ariaLabel="Expenses to date"
        labels={data.current.map((b) => b.label)}
        compareLabels={search.compare ? data.current.map((_, i) => data.prior[i]?.label) : undefined}
        series={series}
        formatAxis={compact}
        formatValue={moneyNumber}
      />
    );
    const total = current.findLast((v) => v !== null) ?? 0;
    const before = prior.at(-1) ?? 0;
    const end = range.to < todayIso() ? range.to : todayIso();
    const days = Math.max(1, daysBetween(range.from, end) + 1);
    tiles = (
      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Stat label="Expenses" value={moneyNumber(total)} />
        <Stat label={data.previous.label} value={moneyNumber(before)} sub={changeText(total, before)} />
        <Stat label="Per day" value={moneyNumber(total / days)} sub={`over ${days} day${days === 1 ? '' : 's'}`} />
      </div>
    );
  }

  return (
    <>
      <DashboardHeader
        title="Expenses"
        description={`${data?.range.label ?? ''}, compared with ${data?.previous.label ?? ''}`}
        search={search}
        set={set}
        reset={{ res: undefined }}
      />
      {tiles}
      <ChartCard
        title="Expenses over the period"
        description="Running total of every outflow, refunds netted off."
        loading={isPlaceholderData}
        controls={
          <>
            <ResolutionControl range={range} value={data?.resolution ?? resolution} onChange={(res) => set({ res })} />
            <label className="flex cursor-pointer items-center gap-1.5 text-xs">
              <input type="checkbox" checked={!!search.compare} onChange={(e) => set({ compare: e.target.checked || undefined })} />
              Compare with {data?.previous.label ?? 'the previous period'}
            </label>
          </>
        }
      >
        {body}
      </ChartCard>
    </>
  );
}

const changeText = (now: number, before: number) => {
  if (before === 0) return undefined;
  const pct = Math.round(((now - before) / Math.abs(before)) * 100);
  return `This period is ${pct >= 0 ? `${pct}% higher` : `${-pct}% lower`}`;
};

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card className="p-3">
      <div className="text-muted text-xs">{label}</div>
      <div className="tabular text-lg font-semibold">{value}</div>
      {sub && <div className="text-muted text-xs">{sub}</div>}
    </Card>
  );
}
