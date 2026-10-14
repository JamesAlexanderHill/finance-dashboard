import { queryOptions, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useServerFn } from '@tanstack/react-start';
import { useState } from 'react';
import { Badge, Button, Card, PageHeader } from '../../components/ui';
import { flattenTree } from '../../lib/category-tree';
import { createCategory, deleteCategory, listCategories, renameCategory } from '../../server/categories.functions';

export const categoriesQuery = queryOptions({ queryKey: ['categories'], queryFn: () => listCategories() });

export const Route = createFileRoute('/_app/categories')({
  loader: ({ context }) => context.queryClient.ensureQueryData(categoriesQuery),
  component: CategoriesPage,
});

function CategoriesPage() {
  const queryClient = useQueryClient();
  const { data } = useSuspenseQuery(categoriesQuery);
  const create = useServerFn(createCategory);
  const rename = useServerFn(renameCategory);
  const remove = useServerFn(deleteCategory);
  const [error, setError] = useState<string | null>(null);
  const flat = flattenTree(data.categories);

  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      await queryClient.invalidateQueries();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    }
  };

  const add = (parentId: string, parentName: string) => {
    const name = prompt(`New category under ${parentName}`);
    if (name?.trim()) void run(() => create({ data: { parentId, name } }));
  };

  const del = (id: string, name: string, parentId: string | null) => {
    const options = flat.filter((c) => c.id !== id && c.kind === flat.find((x) => x.id === id)?.kind);
    const fallback = options.find((c) => c.id === parentId) ?? options[0];
    const choice = prompt(
      `Delete "${name}". Move its legs to which category?\n${options.map((c, i) => `${i + 1}. ${c.path}`).join('\n')}`,
      String(options.indexOf(fallback!) + 1),
    );
    const target = choice ? options[Number(choice) - 1] : undefined;
    if (target) void run(() => remove({ data: { id, reassignTo: target.id } }));
  };

  return (
    <>
      <PageHeader
        title="Categories"
        description="Categories describe spending behaviour. Income, Savings, Essentials and Lifestyle are fixed; add any depth of subcategories beneath them."
      />
      {error && <p className="text-negative mb-4 text-sm">{error}</p>}
      <Card>
        {flat.map((c) => (
          <div
            key={c.id}
            className="border-line flex items-center gap-3 border-b px-4 py-2 last:border-0"
            style={{ paddingLeft: 16 + c.depth * 24 }}
          >
            <span className={c.depth === 0 ? 'font-semibold' : ''}>{c.name}</span>
            {c.depth === 0 && <Badge>{c.kind}</Badge>}
            <span className="text-muted tabular text-xs">{c.legCount} legs</span>
            <div className="ml-auto flex gap-1">
              <Button variant="ghost" onClick={() => add(c.id, c.name)}>
                Add child
              </Button>
              {!c.isFixed && (
                <>
                  <Button
                    variant="ghost"
                    onClick={() => {
                      const name = prompt('Rename category', c.name);
                      if (name?.trim()) void run(() => rename({ data: { id: c.id, name } }));
                    }}
                  >
                    Rename
                  </Button>
                  <Button variant="ghost" onClick={() => del(c.id, c.name, c.parentId)}>
                    Delete
                  </Button>
                </>
              )}
            </div>
          </div>
        ))}
      </Card>
    </>
  );
}
