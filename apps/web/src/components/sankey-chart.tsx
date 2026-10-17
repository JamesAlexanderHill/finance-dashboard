import { sankey, sankeyJustify, sankeyLinkHorizontal, type SankeyLink as D3Link, type SankeyNode as D3Node } from 'd3-sankey';
import { useEffect, useMemo, useRef, useState } from 'react';
import { money } from '../lib/format';

export interface ChartNode {
  id: string;
  label: string;
  value: string;
  role: string;
  root: string | null;
  drillable: boolean;
}
export interface ChartLink {
  source: string;
  target: string;
  value: string;
}

/** d3-sankey overwrites `value` with a number, so the exact decimal travels as `amount`. */
type Datum = Omit<ChartNode, 'value'> & { amount: string };
type N = D3Node<Datum, object>;
type L = D3Link<Datum, object>;

/** Fixed top-level categories take categorical slots in fixed order; everything else is neutral. */
const ROOT_SLOT: Record<string, string> = {
  Income: 'var(--series-1)',
  Savings: 'var(--series-2)',
  Essentials: 'var(--series-3)',
  Lifestyle: 'var(--series-4)',
};
const colorFor = (n: { root: string | null }) => (n.root && ROOT_SLOT[n.root]) || 'var(--series-neutral)';

const MIN_WIDTH = 680;

function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (!ref.current) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.floor(entry!.contentRect.width)));
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  return { ref, width };
}

export function SankeyChart({ nodes, links, onSelect }: { nodes: ChartNode[]; links: ChartLink[]; onSelect: (node: ChartNode) => void }) {
  const { ref, width } = useWidth();
  const [hover, setHover] = useState<{ x: number; y: number; text: string } | null>(null);
  const height = Math.max(320, Math.min(720, nodes.length * 34));

  const layout = useMemo(() => {
    if (width === 0 || links.length === 0) return null;
    const labelRoom = 170;
    const generator = sankey<Datum, object>()
      .nodeId((d) => d.id)
      .nodeAlign(sankeyJustify)
      .nodeWidth(10)
      .nodePadding(16)
      .nodeSort(null)
      .extent([
        [labelRoom, 8],
        [width - labelRoom, height - 8],
      ]);
    return generator({
      nodes: nodes.map(({ value, ...n }) => ({ ...n, amount: value })),
      links: links.map((l) => ({ source: l.source, target: l.target, value: Number(l.value), raw: l.value })),
    });
  }, [nodes, links, width, height]);

  const show = (e: React.MouseEvent, text: string) => {
    const box = ref.current!.getBoundingClientRect();
    setHover({ x: e.clientX - box.left, y: e.clientY - box.top, text });
  };

  return (
    // Below ~680px the columns collide, so narrow screens scroll the chart inside its card.
    <div className="overflow-x-auto">
      <div ref={ref} className="relative w-full" style={{ minWidth: MIN_WIDTH }}>
        {layout && (
          <svg width={width} height={height} role="img" aria-label="Cash-flow Sankey diagram">
            <g fill="none">
              {layout.links.map((l: L, i) => {
                const source = l.source as N;
                const target = l.target as N;
                const color = colorFor(source.role === 'hub' ? target : source);
                return (
                  <path
                    key={i}
                    d={sankeyLinkHorizontal()(l) ?? undefined}
                    stroke={color}
                    strokeOpacity={0.35}
                    strokeWidth={Math.max(1, l.width ?? 1)}
                    onMouseMove={(e) => show(e, `${source.label} → ${target.label}: ${money((l as L & { raw: string }).raw)}`)}
                    onMouseLeave={() => setHover(null)}
                    className="hover:stroke-opacity-60"
                  />
                );
              })}
            </g>
            {layout.nodes.map((n: N) => {
              const clickable =
                n.drillable ||
                n.role === 'uncategorised-income' ||
                n.role === 'uncategorised-expense' ||
                n.role === 'category' ||
                n.role === 'other';
              const leftSide = (n.x0 ?? 0) < width / 2;
              const nodeHeight = Math.max(2, (n.y1 ?? 0) - (n.y0 ?? 0));
              return (
                <g
                  key={n.id}
                  onClick={() => clickable && onSelect({ ...n, value: n.amount })}
                  onMouseMove={(e) =>
                    show(
                      e,
                      `${n.label}: ${money(n.amount)}${n.drillable ? ' · click to drill in' : clickable ? ' · click to list legs' : ''}`,
                    )
                  }
                  onMouseLeave={() => setHover(null)}
                  className={clickable ? 'cursor-pointer' : ''}
                >
                  {/* Hit target larger than the mark. */}
                  <rect x={(n.x0 ?? 0) - 6} y={(n.y0 ?? 0) - 2} width={22} height={nodeHeight + 4} fill="transparent" />
                  <rect x={n.x0} y={n.y0} width={(n.x1 ?? 0) - (n.x0 ?? 0)} height={nodeHeight} rx={2} fill={colorFor(n)} />
                  <text
                    x={leftSide ? (n.x0 ?? 0) - 6 : (n.x1 ?? 0) + 6}
                    y={((n.y0 ?? 0) + (n.y1 ?? 0)) / 2}
                    textAnchor={leftSide ? 'end' : 'start'}
                    className="text-xs"
                  >
                    <tspan dy={nodeHeight >= 26 ? '-0.2em' : '0.35em'} className={`fill-ink ${n.drillable ? 'underline' : ''}`}>
                      {n.label}
                    </tspan>
                    {nodeHeight >= 26 && (
                      <tspan x={leftSide ? (n.x0 ?? 0) - 6 : (n.x1 ?? 0) + 6} dy="1.2em" className="fill-muted tabular">
                        {money(n.amount)}
                      </tspan>
                    )}
                  </text>
                </g>
              );
            })}
          </svg>
        )}
        {hover && (
          <div
            className="border-line bg-surface pointer-events-none absolute z-10 rounded border px-2 py-1 text-xs shadow-sm"
            style={{ left: Math.min(hover.x + 12, Math.max(0, width - 220)), top: hover.y + 12 }}
          >
            {hover.text}
          </div>
        )}
      </div>
    </div>
  );
}
