export interface CategoryNode {
  id: string;
  parentId: string | null;
  name: string;
  kind: 'income' | 'expense';
  isFixed: boolean;
}

/** Flattens the tree depth-first with depth and full path, for pickers and indented lists. */
export function flattenTree<T extends CategoryNode>(categories: readonly T[]) {
  const children = new Map<string | null, T[]>();
  for (const c of categories) children.set(c.parentId, [...(children.get(c.parentId) ?? []), c]);
  const out: Array<T & { depth: number; path: string }> = [];
  const walk = (parentId: string | null, depth: number, prefix: string) => {
    for (const c of children.get(parentId) ?? []) {
      const path = prefix ? `${prefix} › ${c.name}` : c.name;
      out.push({ ...c, depth, path });
      walk(c.id, depth + 1, path);
    }
  };
  walk(null, 0, '');
  return out;
}
