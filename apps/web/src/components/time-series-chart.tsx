import { useMemo, useState } from 'react';
import { shortDate } from '../lib/format';
import { useWidth } from '../lib/use-width';

export interface SeriesPoint {
  on: string;
  /** Chart geometry only; exact values travel in `label`. */
  value: number;
  label: string;
  /** Drawn as an open marker (e.g. a trade-priced value). */
  hollow?: boolean;
}

export interface ChartMarker {
  on: string;
  label: string;
}

const HEIGHT = 190;
const PAD = { top: 12, right: 16, bottom: 26, left: 64 };
const day = (iso: string) => Date.parse(`${iso}T00:00:00Z`);

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
 * A single-series time chart: `line` joins observations, `step` holds each value until the next
 * change (units held). Points are only drawn where data exists; nothing is interpolated between gaps
 * for markers or tooltips. All charts given the same `domain` share an x-axis for comparison.
 */
export function TimeSeriesChart(props: {
  title: string;
  points: SeriesPoint[];
  kind: 'line' | 'step';
  domain: [string, string];
  formatAxis: (n: number) => string;
  zeroBased?: boolean;
  markers?: ChartMarker[];
  showDots?: boolean;
}) {
  const { ref, width } = useWidth();
  const [hover, setHover] = useState<SeriesPoint | null>(null);
  const { points, kind } = props;

  const geometry = useMemo(() => {
    if (width === 0 || points.length === 0) return null;
    const [x0, x1] = [day(props.domain[0]), Math.max(day(props.domain[1]), day(props.domain[0]) + 86_400_000)];
    const values = points.map((p) => p.value);
    let [y0, y1] = [Math.min(...values), Math.max(...values)];
    if (props.zeroBased) y0 = Math.min(0, y0);
    if (y0 === y1) [y0, y1] = [y0 * 0.9, y1 * 1.1 || 1];
    const pad = (y1 - y0) * 0.08;
    if (!props.zeroBased) y0 -= pad;
    y1 += pad;
    const x = (iso: string) => PAD.left + ((day(iso) - x0) / (x1 - x0)) * (width - PAD.left - PAD.right);
    const y = (v: number) => PAD.top + (1 - (v - y0) / (y1 - y0)) * (HEIGHT - PAD.top - PAD.bottom);
    const path = points
      .map((p, i) => {
        if (i === 0) return `M${x(p.on)},${y(p.value)}`;
        return kind === 'step' ? `H${x(p.on)}V${y(p.value)}` : `L${x(p.on)},${y(p.value)}`;
      })
      .join('');
    const years: string[] = [];
    for (let yr = new Date(x0).getUTCFullYear(); yr <= new Date(x1).getUTCFullYear(); yr++) years.push(`${yr}-01-01`);
    return { x, y, path, yTicks: niceTicks(y0, y1), xTicks: years.filter((d) => day(d) >= x0 && day(d) <= x1) };
  }, [width, points, kind, props.domain, props.zeroBased]);

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!geometry) return;
    const mx = e.clientX - e.currentTarget.getBoundingClientRect().left;
    let best = points[0]!;
    for (const p of points) if (Math.abs(geometry.x(p.on) - mx) < Math.abs(geometry.x(best.on) - mx)) best = p;
    setHover(best);
  };

  return (
    <figure className="m-0">
      <figcaption className="mb-1 text-sm font-medium">{props.title}</figcaption>
      <div ref={ref} className="relative w-full">
        {points.length === 0 && <p className="text-muted py-8 text-center text-sm">No data yet.</p>}
        {geometry && (
          <svg width={width} height={HEIGHT} onMouseMove={onMove} onMouseLeave={() => setHover(null)} role="img" aria-label={props.title}>
            {geometry.yTicks.map((t) => (
              <g key={t}>
                <line x1={PAD.left} x2={width - PAD.right} y1={geometry.y(t)} y2={geometry.y(t)} stroke="var(--border)" strokeWidth={1} />
                <text x={PAD.left - 8} y={geometry.y(t)} dy="0.32em" textAnchor="end" className="fill-muted tabular text-[11px]">
                  {props.formatAxis(t)}
                </text>
              </g>
            ))}
            {geometry.xTicks.map((d) => (
              <text key={d} x={geometry.x(d)} y={HEIGHT - 8} textAnchor="middle" className="fill-muted text-[11px]">
                {d.slice(0, 4)}
              </text>
            ))}
            <path d={geometry.path} fill="none" stroke="var(--series-1)" strokeWidth={2} strokeLinejoin="round" />
            {props.markers?.map((m, i) => (
              <path key={i} d={`M${geometry.x(m.on)},${HEIGHT - PAD.bottom}l-4,6h8z`} fill="var(--series-2)" aria-label={m.label} />
            ))}
            {props.showDots &&
              points.map((p) => (
                <circle
                  key={p.on}
                  cx={geometry.x(p.on)}
                  cy={geometry.y(p.value)}
                  r={4}
                  fill={p.hollow ? 'var(--surface)' : 'var(--series-1)'}
                  stroke="var(--series-1)"
                  strokeWidth={2}
                />
              ))}
            {hover && (
              <g pointerEvents="none">
                <line
                  x1={geometry.x(hover.on)}
                  x2={geometry.x(hover.on)}
                  y1={PAD.top}
                  y2={HEIGHT - PAD.bottom}
                  stroke="var(--muted)"
                  strokeDasharray="3 3"
                />
                <circle
                  cx={geometry.x(hover.on)}
                  cy={geometry.y(hover.value)}
                  r={5}
                  fill="var(--series-1)"
                  stroke="var(--surface)"
                  strokeWidth={2}
                />
              </g>
            )}
          </svg>
        )}
        {hover && geometry && (
          <div
            className="border-line bg-surface pointer-events-none absolute top-0 z-10 rounded border px-2 py-1 text-xs shadow-sm"
            style={{ left: Math.min(Math.max(0, geometry.x(hover.on) + 10), Math.max(0, width - 200)) }}
          >
            <div className="text-muted">{shortDate(hover.on)}</div>
            <div className="tabular">{hover.label}</div>
          </div>
        )}
      </div>
    </figure>
  );
}
