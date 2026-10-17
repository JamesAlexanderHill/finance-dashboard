import { queryOptions, useSuspenseQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { z } from 'zod';
import {
  daysBetween,
  presetPrevious,
  presetRange,
  previousRange,
  RANGE_PRESETS,
  todayIso,
  type DateRange,
  type RangePreset,
} from '@finance/shared';
import { money } from '../lib/format';
import { listCategories } from '../server/categories.functions';
import { getDashboardSummary, getFlowSeries, getNetWorthSeries } from '../server/dashboard.functions';
import { PeriodPicker } from './period-picker';
import { Card, Empty, PageHeader } from './ui';

// Shared by the Dashboard's Overview and Expenses tabs: one page period in the URL drives both.

export const RESOLUTIONS = ['day', 'week', 'month', 'quarter', 'year'] as const;
export type Resolution = (typeof RESOLUTIONS)[number];
export const resolutionParam = z.enum(RESOLUTIONS).optional();

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
/** Search params for the page period: a preset relative to today, or `custom` with from/to. */
export const periodSearch = {
  preset: z.enum(['custom', ...RANGE_PRESETS.map((p) => p.id)] as ['custom', ...RangePreset[]]).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  tags: z.array(z.uuid()).optional(),
};
export type PeriodSearch = { preset?: RangePreset | 'custom'; from?: string; to?: string; tags?: string[] };

export const DEFAULT_PRESET: RangePreset = 'mtd';
const isCustom = (s: PeriodSearch): s is PeriodSearch & { from: string; to: string } => s.preset === 'custom' && !!s.from && !!s.to;

/** The page period the search names; defaults to month to date. */
export function pageRange(s: PeriodSearch): DateRange {
  if (isCustom(s)) return s.from <= s.to ? { from: s.from, to: s.to } : { from: s.to, to: s.from };
  return presetRange(s.preset && s.preset !== 'custom' ? s.preset : DEFAULT_PRESET, todayIso());
}

/** The period the page compares with: the preset's own (e.g. quarter to date last quarter), else the one before. */
export function compareRange(s: PeriodSearch): DateRange {
  if (isCustom(s)) return previousRange(pageRange(s));
  return presetPrevious(s.preset && s.preset !== 'custom' ? s.preset : DEFAULT_PRESET, todayIso());
}

/** Approximate days per bucket, to pick a default resolution and rule out ones with too many buckets. */
const BUCKET_DAYS: Record<Resolution, number> = { day: 1, week: 7, month: 30.4, quarter: 91, year: 365 };
const MAX_BUCKETS = 400;
const span = (r: DateRange) => daysBetween(r.from, r.to) + 1;
export function defaultResolution(r: DateRange): Resolution {
  const days = span(r);
  return days <= 31 ? 'day' : days <= 120 ? 'week' : days <= 1100 ? 'month' : days <= 3000 ? 'quarter' : 'year';
}

const compareParams = (c: DateRange) => ({ compareFrom: c.from, compareTo: c.to });
export const summaryQuery = (r: DateRange, c: DateRange, tagIds: string[]) =>
  queryOptions({
    queryKey: ['dashboard', 'summary', r, c, tagIds],
    queryFn: () => getDashboardSummary({ data: { ...r, ...compareParams(c), tagIds } }),
  });
export const netWorthQuery = (r: DateRange, res: Resolution) =>
  queryOptions({
    queryKey: ['dashboard', 'net-worth', r, res],
    queryFn: () => getNetWorthSeries({ data: { ...r, resolution: res, tagIds: [], expenseFocus: null } }),
  });
export const flowQuery = (r: DateRange, c: DateRange, res: Resolution, tagIds: string[], focus: string | null) =>
  queryOptions({
    queryKey: ['dashboard', 'flows', r, c, res, tagIds, focus],
    queryFn: () => getFlowSeries({ data: { ...r, ...compareParams(c), resolution: res, tagIds, expenseFocus: focus } }),
  });
export const categoriesQuery = queryOptions({ queryKey: ['categories'], queryFn: () => listCategories() });
export type FlowData = Awaited<ReturnType<typeof getFlowSeries>>;

export const compact = (n: number) => {
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}m`;
  if (abs >= 1000) return `${sign}$${(abs / 1000).toFixed(abs >= 10_000 ? 0 : 1)}k`;
  return `${sign}$${abs.toFixed(0)}`;
};
export const moneyNumber = (n: number) => money(n.toFixed(2));
export const num = (v: string | null | undefined) => (v == null ? null : Number(v));

/**
 * The page title with the period picker beside it and, below, the tag filter. Changing the period
 * clears `reset` (each chart's resolution) so charts fall back to a default that suits the new range.
 */
export function DashboardHeader<S extends PeriodSearch>({
  title,
  description,
  search,
  set,
  reset,
}: {
  title: string;
  description: ReactNode;
  search: S;
  set: (patch: Partial<S>) => void;
  reset: Partial<S>;
}) {
  const { data: cats } = useSuspenseQuery(categoriesQuery);
  const tags = search.tags ?? [];
  const range = pageRange(search);
  return (
    <>
      <PageHeader
        title={title}
        description={description}
        actions={
          <PeriodPicker
            value={search.preset === 'custom' ? { preset: 'custom', range } : { preset: search.preset ?? DEFAULT_PRESET, range }}
            onChange={(v) =>
              set({
                ...reset,
                preset: v.preset === DEFAULT_PRESET ? undefined : v.preset,
                from: v.preset === 'custom' ? v.range.from : undefined,
                to: v.preset === 'custom' ? v.range.to : undefined,
              } as Partial<S>)
            }
          />
        }
      />
      {cats.tags.length > 0 && (
        <div className="-mt-3 mb-6 flex flex-wrap items-center gap-1.5 text-xs">
          <span className="text-muted">Tags</span>
          {cats.tags.map((tag) => {
            const on = tags.includes(tag.id);
            const next = on ? tags.filter((t) => t !== tag.id) : [...tags, tag.id];
            return (
              <button
                key={tag.id}
                onClick={() => set({ tags: next.length ? next : undefined } as Partial<S>)}
                className={`rounded-full border px-2 py-0.5 ${on ? 'border-accent bg-accent text-accent-ink' : 'border-line bg-surface'}`}
                aria-pressed={on}
              >
                {tag.name}
              </button>
            );
          })}
        </div>
      )}
    </>
  );
}

export function Segmented<T extends string>({
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

/** The resolution control every time-series chart has; resolutions with too many buckets are disabled. */
export function ResolutionControl({ range, value, onChange }: { range: DateRange; value: Resolution; onChange: (r: Resolution) => void }) {
  return (
    <Segmented
      label="Resolution"
      options={RESOLUTIONS}
      value={value}
      disabled={(r) => span(range) / BUCKET_DAYS[r] > MAX_BUCKETS}
      onChange={onChange}
    />
  );
}

/** A dashboard chart card: title, its own controls and a body that dims while new data loads. */
export function ChartCard({
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

export const Loading = () => <Empty>Loading…</Empty>;
