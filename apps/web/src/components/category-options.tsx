interface Option {
  id: string;
  name: string;
  depth: number;
}

/**
 * `<option>`s for a native category select, from `flattenTree` order: each top-level category heads a
 * group (and is itself selectable), and deeper levels are indented beneath it. Plain spaces collapse
 * inside options, so the indent uses non-breaking ones.
 */
export function CategoryOptions({ categories }: { categories: readonly Option[] }) {
  const groups: Array<{ top: Option; children: Option[] }> = [];
  for (const c of categories) {
    if (c.depth === 0) groups.push({ top: c, children: [] });
    else groups.at(-1)?.children.push(c);
  }
  return groups.map(({ top, children }) => (
    <optgroup key={top.id} label={top.name}>
      <option value={top.id}>{top.name}</option>
      {children.map((c) => (
        <option key={c.id} value={c.id}>
          {'   '.repeat(c.depth)}└ {c.name}
        </option>
      ))}
    </optgroup>
  ));
}
