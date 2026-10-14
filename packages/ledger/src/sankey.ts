import { add, cmp, isPositive, neg, sub, type DecimalString } from '@finance/shared';

export interface SankeyCategory {
  id: string;
  parentId: string | null;
  name: string;
  kind: 'income' | 'expense';
}

/** A cash-flow leg in the period (already filtered to non-internal, active, in-period and by tag). */
export interface SankeyLeg {
  amount: DecimalString;
  categoryId: string | null;
}

export type SankeyNodeRole = 'category' | 'uncategorised-income' | 'uncategorised-expense' | 'unallocated' | 'drawn' | 'hub' | 'other';

export interface SankeyNode {
  id: string;
  label: string;
  value: DecimalString;
  role: SankeyNodeRole;
  categoryId: string | null;
  /** True when the node has children to drill into. */
  drillable: boolean;
}

export interface SankeyLink {
  source: string;
  target: string;
  value: DecimalString;
}

export interface CashFlowTotals {
  income: DecimalString;
  outflow: DecimalString;
  spending: DecimalString;
  saved: DecimalString;
  /** Income minus every outflow; equals the Unallocated node (or minus Drawn from savings). */
  netCashFlow: DecimalString;
  uncategorisedIncome: DecimalString;
  uncategorisedExpense: DecimalString;
}

export interface SankeyResult {
  totals: CashFlowTotals;
  nodes: SankeyNode[];
  links: SankeyLink[];
  /** Nodes left out because refunds made their net flow negative. */
  negative: Array<{ label: string; value: DecimalString }>;
}

export const UNCATEGORISED_INCOME = 'uncategorised-income';
export const UNCATEGORISED_EXPENSE = 'uncategorised-expense';
const HUB = 'hub';

interface Tree {
  byId: Map<string, SankeyCategory>;
  children: Map<string | null, SankeyCategory[]>;
}

function buildTree(categories: readonly SankeyCategory[]): Tree {
  const byId = new Map(categories.map((c) => [c.id, c]));
  const children = new Map<string | null, SankeyCategory[]>();
  for (const c of categories) {
    const key = c.parentId && byId.has(c.parentId) ? c.parentId : null;
    children.set(key, [...(children.get(key) ?? []), c]);
  }
  return { byId, children };
}

/**
 * Aggregates a period's cash-flow legs into a Sankey (feature 14).
 *
 * Default view: income sources → hub → top-level expense categories → one child level.
 * With `focusId`, the view drills into that category's subtree.
 * Income-kind flow is +amount; expense-kind flow is −amount, so refunds reduce spending.
 */
export function buildSankey(legs: readonly SankeyLeg[], categories: readonly SankeyCategory[], focusId?: string | null): SankeyResult {
  const tree = buildTree(categories);
  /** Net flow per category (own legs only) in "positive = normal direction" terms. */
  const own = new Map<string, DecimalString>();
  let uncategorisedIncome = '0';
  let uncategorisedExpense = '0';

  for (const leg of legs) {
    const category = leg.categoryId ? tree.byId.get(leg.categoryId) : undefined;
    if (!category) {
      if (isPositive(leg.amount)) uncategorisedIncome = add(uncategorisedIncome, leg.amount);
      else uncategorisedExpense = add(uncategorisedExpense, neg(leg.amount));
      continue;
    }
    const flow = category.kind === 'income' ? leg.amount : neg(leg.amount);
    own.set(category.id, add(own.get(category.id) ?? '0', flow));
  }

  const totalMemo = new Map<string, DecimalString>();
  const subtreeTotal = (id: string): DecimalString => {
    const cached = totalMemo.get(id);
    if (cached !== undefined) return cached;
    const value = add(own.get(id) ?? '0', ...(tree.children.get(id) ?? []).map((c) => subtreeTotal(c.id)));
    totalMemo.set(id, value);
    return value;
  };

  const roots = tree.children.get(null) ?? [];
  const incomeRoots = roots.filter((r) => r.kind === 'income');
  const expenseRoots = roots.filter((r) => r.kind === 'expense');
  const sumOf = (cats: SankeyCategory[]) => add('0', ...cats.map((c) => subtreeTotal(c.id)));

  const income = add(sumOf(incomeRoots), uncategorisedIncome);
  const outflow = add(sumOf(expenseRoots), uncategorisedExpense);
  const netCashFlow = sub(income, outflow);
  const totals: CashFlowTotals = {
    income,
    outflow,
    spending: sumOf(expenseRoots.filter((r) => r.name === 'Essentials' || r.name === 'Lifestyle')),
    saved: sumOf(expenseRoots.filter((r) => r.name === 'Savings')),
    netCashFlow,
    uncategorisedIncome,
    uncategorisedExpense,
  };

  const nodes = new Map<string, SankeyNode>();
  const links: SankeyLink[] = [];
  const negative: SankeyResult['negative'] = [];

  const node = (n: Omit<SankeyNode, 'drillable'> & { drillable?: boolean }) => {
    if (!nodes.has(n.id)) nodes.set(n.id, { drillable: false, ...n });
    return n.id;
  };
  const link = (source: string, target: string, value: DecimalString, label: string) => {
    if (cmp(value, '0') < 0) negative.push({ label, value });
    else if (cmp(value, '0') > 0) links.push({ source, target, value });
  };
  const categoryNode = (c: SankeyCategory) =>
    node({
      id: c.id,
      label: c.name,
      value: subtreeTotal(c.id),
      role: 'category',
      categoryId: c.id,
      drillable: (tree.children.get(c.id) ?? []).length > 0,
    });

  /** Links a category to its children (direction depends on kind) plus an "other" node for its own legs. */
  const expand = (c: SankeyCategory) => {
    const kids = tree.children.get(c.id) ?? [];
    if (kids.length === 0) return;
    const parent = categoryNode(c);
    const connect = (childId: string, value: DecimalString, label: string) =>
      c.kind === 'income' ? link(childId, parent, value, label) : link(parent, childId, value, label);
    for (const kid of kids) connect(categoryNode(kid), subtreeTotal(kid.id), kid.name);
    const direct = own.get(c.id);
    if (direct && cmp(direct, '0') !== 0) {
      const id = node({ id: `${c.id}:other`, label: `${c.name} (other)`, value: direct, role: 'other', categoryId: c.id });
      connect(id, direct, `${c.name} (other)`);
    }
  };

  const focus = focusId ? tree.byId.get(focusId) : undefined;
  if (focus) {
    expand(focus);
    for (const kid of tree.children.get(focus.id) ?? []) expand(kid);
    if (nodes.size === 0) categoryNode(focus);
    return { totals, nodes: [...nodes.values()], links, negative };
  }

  const hub = node({ id: HUB, label: 'Cash flow', value: cmp(income, outflow) >= 0 ? income : outflow, role: 'hub', categoryId: null });
  for (const root of incomeRoots) {
    const kids = tree.children.get(root.id) ?? [];
    if (kids.length === 0) link(categoryNode(root), hub, subtreeTotal(root.id), root.name);
    else {
      // Show the Income root's children directly as sources; deeper levels need a drill-down.
      for (const kid of kids) link(categoryNode(kid), hub, subtreeTotal(kid.id), kid.name);
      const direct = own.get(root.id);
      if (direct && cmp(direct, '0') !== 0) {
        link(
          node({ id: `${root.id}:other`, label: `${root.name} (other)`, value: direct, role: 'other', categoryId: root.id }),
          hub,
          direct,
          root.name,
        );
      }
    }
  }
  if (isPositive(uncategorisedIncome)) {
    link(
      node({
        id: UNCATEGORISED_INCOME,
        label: 'Uncategorised income',
        value: uncategorisedIncome,
        role: 'uncategorised-income',
        categoryId: null,
      }),
      hub,
      uncategorisedIncome,
      'Uncategorised income',
    );
  }
  if (cmp(netCashFlow, '0') < 0) {
    const drawn = neg(netCashFlow);
    link(
      node({ id: 'drawn', label: 'Drawn from savings', value: drawn, role: 'drawn', categoryId: null }),
      hub,
      drawn,
      'Drawn from savings',
    );
  }

  for (const root of expenseRoots) {
    link(hub, categoryNode(root), subtreeTotal(root.id), root.name);
    expand(root);
  }
  if (isPositive(uncategorisedExpense)) {
    link(
      hub,
      node({
        id: UNCATEGORISED_EXPENSE,
        label: 'Uncategorised expense',
        value: uncategorisedExpense,
        role: 'uncategorised-expense',
        categoryId: null,
      }),
      uncategorisedExpense,
      'Uncategorised expense',
    );
  }
  if (isPositive(netCashFlow)) {
    link(
      hub,
      node({ id: 'unallocated', label: 'Unallocated', value: netCashFlow, role: 'unallocated', categoryId: null }),
      netCashFlow,
      'Unallocated',
    );
  }

  // Drop nodes that ended up with no links (zero-value categories).
  const linked = new Set(links.flatMap((l) => [l.source, l.target]));
  return { totals, nodes: [...nodes.values()].filter((n) => linked.has(n.id)), links, negative };
}
