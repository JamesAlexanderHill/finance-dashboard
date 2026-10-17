import { useMemo, useState } from 'react';
import { useWidth } from '../lib/use-width';

export interface PeriodSeries {
  key: string;
  label: string;
  /** A CSS colour (use the --series-* tokens). */
  color: string;
  type: 'bar' | 'line';
  /** One value per period; null leaves a gap. */
  values: Array<number | null>;
  /** Bars sharing a stack key are stacked; other bars sit side by side. */
  stack?: string;
  /** Per-period flag: draw this line point as an open marker (stale or partial). */
  hollow?: boolean[];
  /** Draw a line dashed, e.g. the previous period overlaid for comparison. */
  dashed?: boolean;
}

const HEIGHT = 240;
const PAD = { top: 12, right: 12, bottom: 28, left: 64 };
const GAP = 2;
/** Above this many periods, line points are drawn only where they are hollow. */
const DOT_LIMIT = 40;

function niceTicks(min: number, max: number, count = 4) {
  if (min === max) return [min];
  const raw = (max - min) / count;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= raw)!;
  const ticks: number[] = [];
  for (let t = Math.ceil(min / step) * step; t <= max + 1e-9; t += step) ticks.push(Number(t.toFixed(10)));
  return ticks;
}

/**
 * Bars (grouped or stacked) and lines over a sequence of periods on one shared value axis. A legend
 * names every series; hovering a period shows all its values (and any notes); clicking a bar segment
 * calls `onSelect` with its series key (for drill-down).
 */
export function PeriodChart(props: {
  labels: string[];
  series: PeriodSeries[];
  formatAxis: (n: number) => string;
  formatValue: (n: number) => string;
  /** Extra lines for a period's tooltip (e.g. why a point is partial). */
  notes?: string[][];
  /** The previous period's label for each period, shown in the tooltip when dashed series overlay it. */
  compareLabels?: Array<string | undefined>;
  onSelect?: (key: string) => void;
  /** Series keys that can be selected. */
  selectable?: string[];
  ariaLabel: string;
}) {
  const { ref, width } = useWidth();
  const [hover, setHover] = useState<number | null>(null);
  const { labels, series } = props;

  const geometry = useMemo(() => {
    if (width === 0 || labels.length === 0) return null;
    const bars = series.filter((s) => s.type === 'bar');
    const groups = [...new Set(bars.map((s) => s.stack ?? s.key))];
    // Each stack's extent per period: positives stack up from zero, negatives (e.g. net refunds) down.
    const extents: number[] = [0];
    labels.forEach((_, i) => {
      for (const g of groups) {
        let up = 0;
        let down = 0;
        for (const s of bars.filter((b) => (b.stack ?? b.key) === g)) {
          const v = s.values[i] ?? 0;
          if (v >= 0) up += v;
          else down += v;
        }
        extents.push(up, down);
      }
      for (const s of series.filter((x) => x.type === 'line')) if (s.values[i] != null) extents.push(s.values[i]!);
    });
    let [y0, y1] = [Math.min(...extents), Math.max(...extents)];
    if (y0 === y1) y1 = y0 + 1;
    const pad = (y1 - y0) * 0.06;
    y1 += pad;
    if (y0 < 0) y0 -= pad;
    const plotWidth = width - PAD.left - PAD.right;
    const band = plotWidth / labels.length;
    const groupWidth = Math.min(band * 0.7, 28 * groups.length + GAP * (groups.length - 1));
    const barWidth = groups.length ? Math.max(1, (groupWidth - GAP * (groups.length - 1)) / groups.length) : 0;
    const x = (i: number) => PAD.left + band * i + band / 2;
    const y = (v: number) => PAD.top + (1 - (v - y0) / (y1 - y0)) * (HEIGHT - PAD.top - PAD.bottom);

    const rects: Array<{ key: string; i: number; x: number; y: number; w: number; h: number; color: string }> = [];
    labels.forEach((_, i) => {
      groups.forEach((g, gi) => {
        const left = x(i) - groupWidth / 2 + gi * (barWidth + GAP);
        let up = 0;
        let down = 0;
        for (const s of bars.filter((b) => (b.stack ?? b.key) === g)) {
          const v = s.values[i];
          if (!v) continue;
          const [from, to] = v >= 0 ? [up, (up += v)] : [down, (down += v)];
          const top = y(Math.max(from, to));
          // A 2px surface gap separates stacked segments.
          const h = Math.max(1, Math.abs(y(from) - y(to)) - (from !== 0 ? GAP : 0));
          rects.push({ key: s.key, i, x: left, y: v >= 0 ? top : y(from) + (from !== 0 ? GAP : 0), w: barWidth, h, color: s.color });
        }
      });
    });
    // Thin the axis labels so they never collide (about 72px each).
    const labelEvery = Math.max(1, Math.ceil(labels.length / Math.max(1, Math.floor(plotWidth / 72))));
    return { x, y, band, rects, ticks: niceTicks(y0, y1), labelEvery };
  }, [width, labels, series]);

  const lineSeries = series.filter((s) => s.type === 'line');
  return (
    <div>
      <ul className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs" aria-label="Legend">
        {series.map((s) => (
          <li key={s.key} className="text-muted flex items-center gap-1.5">
            {s.type === 'line' ? (
              <span
                className="inline-block w-4"
                style={s.dashed ? { borderTop: `2px dashed ${s.color}` } : { height: 2, borderRadius: 2, background: s.color }}
              />
            ) : (
              <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} />
            )}
            {props.selectable?.includes(s.key) ? (
              <button className="hover:text-ink underline" onClick={() => props.onSelect?.(s.key)}>
                {s.label}
              </button>
            ) : (
              s.label
            )}
          </li>
        ))}
      </ul>
      <div ref={ref} className="relative w-full">
        {geometry && (
          <svg width={width} height={HEIGHT} role="img" aria-label={props.ariaLabel} onMouseLeave={() => setHover(null)}>
            {geometry.ticks.map((t) => (
              <g key={t}>
                <line
                  x1={PAD.left}
                  x2={width - PAD.right}
                  y1={geometry.y(t)}
                  y2={geometry.y(t)}
                  stroke="var(--border)"
                  strokeWidth={t === 0 ? 1.5 : 1}
                />
                <text x={PAD.left - 8} y={geometry.y(t)} dy="0.32em" textAnchor="end" className="fill-muted tabular text-[11px]">
                  {props.formatAxis(t)}
                </text>
              </g>
            ))}
            {labels.map((label, i) => (
              <g key={i} onMouseEnter={() => setHover(i)}>
                <rect
                  x={geometry.x(i) - geometry.band / 2}
                  y={PAD.top}
                  width={geometry.band}
                  height={HEIGHT - PAD.top - PAD.bottom}
                  fill={hover === i ? 'var(--surface-2)' : 'transparent'}
                />
                {i % geometry.labelEvery === 0 && (
                  <text x={geometry.x(i)} y={HEIGHT - 8} textAnchor="middle" className="fill-muted text-[11px]">
                    {label}
                  </text>
                )}
              </g>
            ))}
            {geometry.rects.map((r) => (
              <rect
                key={`${r.key}-${r.i}`}
                x={r.x}
                y={r.y}
                width={r.w}
                height={r.h}
                rx={2}
                fill={r.color}
                onMouseEnter={() => setHover(r.i)}
                onClick={() => props.selectable?.includes(r.key) && props.onSelect?.(r.key)}
                className={props.selectable?.includes(r.key) ? 'cursor-pointer' : ''}
              />
            ))}
            {lineSeries.map((s) => {
              const points = s.values.map((v, i) => (v == null ? null : ([geometry.x(i), geometry.y(v)] as const)));
              const path = points.reduce((d, p, i) => (p ? `${d}${d && points[i - 1] ? 'L' : 'M'}${p[0]},${p[1]}` : d), '');
              return (
                <g key={s.key} pointerEvents="none">
                  <path
                    d={path}
                    fill="none"
                    stroke={s.color}
                    strokeWidth={2}
                    strokeLinejoin="round"
                    strokeDasharray={s.dashed ? '5 4' : undefined}
                  />
                  {points.map((p, i) =>
                    p && !s.dashed && (labels.length <= DOT_LIMIT || s.hollow?.[i]) ? (
                      <circle
                        key={i}
                        cx={p[0]}
                        cy={p[1]}
                        r={4}
                        fill={s.hollow?.[i] ? 'var(--surface)' : s.color}
                        stroke={s.hollow?.[i] ? s.color : 'var(--surface)'}
                        strokeWidth={2}
                      />
                    ) : null,
                  )}
                </g>
              );
            })}
          </svg>
        )}
        {hover !== null && geometry && (
          <div
            className="border-line bg-surface pointer-events-none absolute top-0 z-10 max-w-xs rounded border px-2 py-1 text-xs shadow-sm"
            style={{ left: Math.min(Math.max(0, geometry.x(hover) + geometry.band / 2), Math.max(0, width - 260)) }}
          >
            <div className="text-muted mb-0.5">
              {labels[hover]}
              {props.compareLabels?.[hover] && <span> · dashed: {props.compareLabels[hover]}</span>}
            </div>
            {series
              .filter((s) => s.values[hover] != null && s.values[hover] !== 0)
              .map((s) => (
                <div key={s.key} className="flex items-center gap-1.5">
                  <span
                    className="inline-block h-2 w-2 rounded-sm"
                    style={s.dashed ? { border: `1.5px dashed ${s.color}` } : { background: s.color }}
                  />
                  <span className="flex-1">{s.label}</span>
                  <span className="tabular">{props.formatValue(s.values[hover]!)}</span>
                </div>
              ))}
            {props.notes?.[hover]?.map((n) => (
              <div key={n} className="text-warning mt-0.5">
                {n}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
