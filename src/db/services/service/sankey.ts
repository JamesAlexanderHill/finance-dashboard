import type { Category } from '~/db/schema'
import type { RequestContext } from '../utils/context'
import { querySankeyLegs } from '../query/sankey'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SankeyNode {
  id: string
  name: string
  isIncome: boolean
}

export interface SankeyLink {
  source: string
  target: string
  value: number
}

export interface SankeyData {
  nodes: SankeyNode[]
  links: SankeyLink[]
  totalIncome: number
  totalExpense: number
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Walk the category tree upward from `catId`, adding `amount` to each ancestor
 * (including the category itself) in the aggregates map.
 */
function accumulateAncestors(
  catId: string,
  amount: bigint,
  catMap: Map<string, Category>,
  aggregates: Map<string, bigint>,
) {
  let cat: Category | undefined = catMap.get(catId)
  while (cat) {
    aggregates.set(cat.id, (aggregates.get(cat.id) ?? BigInt(0)) + amount)
    cat = cat.parentId ? catMap.get(cat.parentId) : undefined
  }
}

// ─── Service ──────────────────────────────────────────────────────────────────

/**
 * Build Sankey node/link data for the workspace.
 *
 * `expenseDepth` controls how many levels of expense category hierarchy to show.
 * 1 = top-level expense categories only, 2 = two levels deep, etc.
 *
 * Income categories are always shown as a single aggregated source node (or split
 * by root income category when there are multiple income roots).
 */
async function getData(ctx: RequestContext, expenseDepth = 1): Promise<SankeyData> {
  const { categories, legs } = await querySankeyLegs(ctx.workspaceId)

  if (!categories.length || !legs.length) {
    return { nodes: [], links: [], totalIncome: 0, totalExpense: 0 }
  }

  const catMap = new Map(categories.map((c) => [c.id, c]))

  // Sum unitCount per category, propagating up the tree so every ancestor also
  // receives the contribution.
  const aggregates = new Map<string, bigint>()
  for (const leg of legs) {
    if (!leg.categoryId) continue
    accumulateAncestors(leg.categoryId, leg.unitCount, catMap, aggregates)
  }

  const roots = categories.filter((c) => c.parentId === null)

  // A root is "income" if its aggregate is net positive.
  const incomeRoots = roots.filter((c) => (aggregates.get(c.id) ?? BigInt(0)) > BigInt(0))
  const expenseRoots = roots.filter((c) => (aggregates.get(c.id) ?? BigInt(0)) < BigInt(0))

  const totalIncomeBig = incomeRoots.reduce(
    (s, c) => s + (aggregates.get(c.id) ?? BigInt(0)),
    BigInt(0),
  )
  const totalExpenseBig = expenseRoots.reduce(
    (s, c) => s - (aggregates.get(c.id) ?? BigInt(0)),
    BigInt(0),
  )

  const totalIncome = Number(totalIncomeBig) / 100
  const totalExpense = Number(totalExpenseBig) / 100

  if (totalIncome === 0 && totalExpense === 0) {
    return { nodes: [], links: [], totalIncome: 0, totalExpense: 0 }
  }

  const nodes: SankeyNode[] = []
  const links: SankeyLink[] = []
  const addedIds = new Set<string>()

  function addNode(id: string, name: string, isIncome: boolean) {
    if (!addedIds.has(id)) {
      nodes.push({ id, name, isIncome })
      addedIds.add(id)
    }
  }

  // Determine the income source node(s) and connect them.
  const VIRTUAL_INCOME_ID = '__income__'
  let incomeSourceId: string

  if (incomeRoots.length === 0) {
    // No income categories — nothing to connect from, bail.
    return { nodes: [], links: [], totalIncome: 0, totalExpense: 0 }
  } else if (incomeRoots.length === 1) {
    incomeSourceId = incomeRoots[0].id
    addNode(incomeSourceId, incomeRoots[0].name, true)
  } else {
    // Multiple income root categories: aggregate into a virtual "Income" node,
    // then show each root as a sub-node.
    incomeSourceId = VIRTUAL_INCOME_ID
    addNode(VIRTUAL_INCOME_ID, 'Income', true)
    for (const root of incomeRoots) {
      const amt = Number(aggregates.get(root.id) ?? BigInt(0)) / 100
      addNode(root.id, root.name, true)
      links.push({ source: VIRTUAL_INCOME_ID, target: root.id, value: amt })
    }
  }

  // Recursively add expense categories up to `expenseDepth` levels.
  function addExpenseSubtree(cat: Category, depth: number) {
    addNode(cat.id, cat.name, false)

    if (depth >= expenseDepth) return

    const children = categories.filter((c) => c.parentId === cat.id)
    for (const child of children) {
      const childAmt = aggregates.get(child.id)
      if (!childAmt || childAmt >= BigInt(0)) continue // skip if no expense data

      addExpenseSubtree(child, depth + 1)
      links.push({
        source: cat.id,
        target: child.id,
        value: Math.abs(Number(childAmt)) / 100,
      })
    }
  }

  // Connect income source → each top-level expense category.
  for (const root of expenseRoots) {
    const rootAmt = aggregates.get(root.id)
    if (!rootAmt || rootAmt >= BigInt(0)) continue

    addExpenseSubtree(root, 0)
    links.push({
      source: incomeSourceId,
      target: root.id,
      value: Math.abs(Number(rootAmt)) / 100,
    })
  }

  // Show unallocated income as a "Savings" node so the diagram balances.
  if (totalIncome > totalExpense + 0.005) {
    const savings = totalIncome - totalExpense
    addNode('__savings__', 'Savings', true)
    links.push({ source: incomeSourceId, target: '__savings__', value: savings })
  }

  return { nodes, links, totalIncome, totalExpense }
}

export const sankeyService = { getData }
