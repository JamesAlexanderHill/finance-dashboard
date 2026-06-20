import * as React from 'react'
import { sankey as d3Sankey, sankeyLinkHorizontal } from 'd3-sankey'
import { Group } from '@visx/group'
import { useTooltip, TooltipWithBounds } from '@visx/tooltip'
import { localPoint } from '@visx/event'

// ─── Types ────────────────────────────────────────────────────────────────────

interface NodeInput {
  id: string
  name: string
  isIncome: boolean
}

interface LinkInput {
  source: string
  target: string
  value: number
}

interface SankeyChartProps {
  width: number
  height: number
  nodes: NodeInput[]
  links: LinkInput[]
}

// ─── Colors ───────────────────────────────────────────────────────────────────

const PALETTE = [
  '#3b82f6', // blue-500
  '#8b5cf6', // violet-500
  '#f59e0b', // amber-500
  '#ec4899', // pink-500
  '#14b8a6', // teal-500
  '#f97316', // orange-500
]

function nodeColor(node: { id: string; isIncome: boolean }, index: number): string {
  if (node.id === '__savings__') return '#22c55e' // green-500
  if (node.isIncome) return '#22c55e'
  return PALETTE[index % PALETTE.length]
}

// ─── Chart ────────────────────────────────────────────────────────────────────

const MARGIN = { top: 16, right: 160, bottom: 16, left: 16 }

export function SankeyChart({ width, height, nodes, links }: SankeyChartProps) {
  const { showTooltip, hideTooltip, tooltipData, tooltipLeft, tooltipTop, tooltipOpen } =
    useTooltip<string>()

  if (!nodes.length || !links.length || width < 100) {
    return (
      <div className="flex items-center justify-center h-full text-gray-400 dark:text-gray-500 text-sm">
        No categorized transactions to display
      </div>
    )
  }

  const innerW = width - MARGIN.left - MARGIN.right
  const innerH = height - MARGIN.top - MARGIN.bottom

  if (innerW < 50 || innerH < 50) return null

  // Build a stable color map before running sankey (which mutates nodes)
  const colorMap = new Map<string, string>()
  let expenseIdx = 0
  for (const n of nodes) {
    colorMap.set(n.id, nodeColor(n, n.isIncome ? 0 : expenseIdx++))
  }

  // d3-sankey mutates its input — clone everything first.
  const nodesCopy = nodes.map((n) => ({ ...n }))
  const linksCopy = links.map((l) => ({ ...l }))

  const layout = d3Sankey<NodeInput, LinkInput>()
    .nodeId((d) => d.id)
    .nodeAlign(/* sankeyLeft */ (node, n) => node.depth ?? 0)
    .nodeWidth(14)
    .nodePadding(14)
    .extent([
      [0, 0],
      [innerW, innerH],
    ])

  let graph: ReturnType<typeof layout>
  try {
    graph = layout({ nodes: nodesCopy, links: linksCopy as any })
  } catch {
    return (
      <div className="flex items-center justify-center h-full text-gray-400 dark:text-gray-500 text-sm">
        Unable to compute flow layout
      </div>
    )
  }

  const pathGen = sankeyLinkHorizontal()

  const fmtAUD = (n: number) =>
    n.toLocaleString('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 })

  return (
    <div className="relative select-none">
      <svg width={width} height={height}>
        <Group left={MARGIN.left} top={MARGIN.top}>
          {/* Links */}
          {graph.links.map((link, i) => {
            const src = link.source as any
            const tgt = link.target as any
            const color = colorMap.get(src.id) ?? '#94a3b8'
            const pathD = pathGen(link as any)
            if (!pathD) return null
            return (
              <path
                key={i}
                d={pathD}
                stroke={color}
                strokeWidth={Math.max(1, link.width ?? 1)}
                strokeOpacity={0.3}
                fill="none"
                style={{ cursor: 'default' }}
                onMouseMove={(e) => {
                  const pt = localPoint(e)
                  showTooltip({
                    tooltipData: `${src.name} → ${tgt.name}: ${fmtAUD(link.value)}`,
                    tooltipLeft: (pt?.x ?? 0) + MARGIN.left,
                    tooltipTop: (pt?.y ?? 0) + MARGIN.top,
                  })
                }}
                onMouseLeave={hideTooltip}
              />
            )
          })}

          {/* Nodes */}
          {graph.nodes.map((node) => {
            const n = node as any
            if (n.x0 === undefined) return null
            const color = colorMap.get(n.id) ?? '#94a3b8'
            const nh = Math.max(4, n.y1 - n.y0)
            const midY = (n.y0 + n.y1) / 2
            const onRight = n.x0 > innerW / 2

            return (
              <Group key={n.id}>
                <rect
                  x={n.x0}
                  y={n.y0}
                  width={n.x1 - n.x0}
                  height={nh}
                  fill={color}
                  fillOpacity={0.9}
                  rx={3}
                  style={{ cursor: 'default' }}
                  onMouseMove={(e) => {
                    const pt = localPoint(e)
                    showTooltip({
                      tooltipData: `${n.name}: ${fmtAUD(n.value ?? 0)}`,
                      tooltipLeft: (pt?.x ?? 0) + MARGIN.left,
                      tooltipTop: (pt?.y ?? 0) + MARGIN.top,
                    })
                  }}
                  onMouseLeave={hideTooltip}
                />
                <text
                  x={onRight ? n.x0 - 6 : n.x1 + 6}
                  y={midY}
                  dy="0.35em"
                  fontSize={11}
                  fontFamily="inherit"
                  textAnchor={onRight ? 'end' : 'start'}
                  fill="#6b7280"
                >
                  {n.name}
                </text>
              </Group>
            )
          })}
        </Group>
      </svg>

      {tooltipOpen && tooltipData && (
        <TooltipWithBounds
          key={Math.random()}
          top={tooltipTop}
          left={tooltipLeft}
          style={{
            position: 'absolute',
            background: 'white',
            border: '1px solid #e5e7eb',
            borderRadius: '6px',
            padding: '4px 10px',
            fontSize: '12px',
            pointerEvents: 'none',
            boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
            whiteSpace: 'nowrap',
          }}
        >
          {tooltipData}
        </TooltipWithBounds>
      )}
    </div>
  )
}
