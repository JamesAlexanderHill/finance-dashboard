import { queryOptions, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useServerFn } from '@tanstack/react-start';
import { useState, type FormEvent } from 'react';
import { Badge, Button, Card, PageHeader } from '../../components/ui';
import { flattenTree } from '../../lib/category-tree';
import { createCategory, deleteCategory, listCategories, renameCategory } from '../../server/categories.functions';

export const categoriesQuery = queryOptions({ queryKey: ['categories'], queryFn: () => listCategories() });

export const Route = createFileRoute('/_app/events/categories')({
  loader: ({ context }) => context.queryClient.ensureQueryData(categoriesQuery),
  component: CategoriesPage,
});

type Flat = ReturnType<typeof flattenTree<Awaited<ReturnType<typeof listCategories>>['categories'][number]>>[number];
type Mode = { id: string; action: 'add' | 'rename' | 'delete' } | null;

const field = 'border-line bg-surface rounded border px-2 py-1 text-sm';

function CategoriesPage() {
  const queryClient = useQueryClient();
  const { data } = useSuspenseQuery(categoriesQuery);
  const [mode, setMode] = useState<Mode>(null);
  const [error, setError] = useState<string | null>(null);
  const flat = flattenTree(data.categories);
  const parents = new Set(flat.map((c) => c.parentId));

  /** Runs a change, refreshes everything that shows categories, and closes the open editor. */
  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      setMode(null);
      await queryClient.invalidateQueries();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    }
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
          <CategoryRow
            key={c.id}
            category={c}
            categories={flat}
            hasChildren={parents.has(c.id)}
            action={mode?.id === c.id ? mode.action : null}
            setAction={(action) => {
              setError(null);
              setMode(action ? { id: c.id, action } : null);
            }}
            run={run}
          />
        ))}
      </Card>
    </>
  );
}

function CategoryRow(props: {
  category: Flat;
  categories: Flat[];
  hasChildren: boolean;
  action: 'add' | 'rename' | 'delete' | null;
  setAction: (action: 'add' | 'rename' | 'delete' | null) => void;
  run: (fn: () => Promise<unknown>) => Promise<void>;
}) {
  const { category: c, action, setAction, run } = props;
  const create = useServerFn(createCategory);
  const rename = useServerFn(renameCategory);
  const remove = useServerFn(deleteCategory);
  const indent = { paddingLeft: 16 + c.depth * 24 };
  const cancel = () => setAction(null);

  return (
    <div className="border-line border-b last:border-0">
      <div className="flex flex-wrap items-center gap-3 px-4 py-2" style={indent}>
        {action === 'rename' ? (
          <NameForm
            initial={c.name}
            label={`New name for ${c.name}`}
            submitLabel="Rename"
            onSubmit={(name) => run(() => rename({ data: { id: c.id, name } }))}
            onCancel={cancel}
          />
        ) : (
          <>
            <span className={c.depth === 0 ? 'font-semibold' : ''}>{c.name}</span>
            {c.depth === 0 && <Badge>{c.kind}</Badge>}
            <span className="text-muted tabular text-xs">{c.legCount} legs</span>
            <div className="ml-auto flex gap-1">
              <Button variant="ghost" onClick={() => setAction('add')}>
                Add child
              </Button>
              {!c.isFixed && (
                <>
                  <Button variant="ghost" onClick={() => setAction('rename')}>
                    Rename
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={props.hasChildren}
                    title={props.hasChildren ? 'Delete or move its subcategories first' : undefined}
                    onClick={() => setAction('delete')}
                  >
                    Delete
                  </Button>
                </>
              )}
            </div>
          </>
        )}
      </div>
      {action === 'add' && (
        <div className="px-4 pb-2" style={{ paddingLeft: 16 + (c.depth + 1) * 24 }}>
          <NameForm
            label={`New category under ${c.name}`}
            placeholder={`New category under ${c.name}`}
            submitLabel="Add"
            onSubmit={(name) => run(() => create({ data: { parentId: c.id, name } }))}
            onCancel={cancel}
          />
        </div>
      )}
      {action === 'delete' && (
        <DeleteForm
          category={c}
          categories={props.categories}
          onSubmit={(reassignTo) => run(() => remove({ data: { id: c.id, reassignTo } }))}
          onCancel={cancel}
        />
      )}
    </div>
  );
}

function NameForm(props: {
  initial?: string;
  label: string;
  placeholder?: string;
  submitLabel: string;
  onSubmit: (name: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState(props.initial ?? '');
  return (
    <form
      className="flex flex-1 flex-wrap items-center gap-2"
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        if (name.trim()) void props.onSubmit(name.trim());
      }}
    >
      <input
        autoFocus
        required
        value={name}
        placeholder={props.placeholder}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === 'Escape' && props.onCancel()}
        className={`${field} min-w-0 flex-1 sm:max-w-xs`}
        aria-label={props.label}
      />
      <Button variant="primary" type="submit">
        {props.submitLabel}
      </Button>
      <Button type="button" variant="ghost" onClick={props.onCancel}>
        Cancel
      </Button>
    </form>
  );
}

/** Deleting archives the category; its legs move to another category of the same kind (default: its parent). */
function DeleteForm(props: { category: Flat; categories: Flat[]; onSubmit: (reassignTo: string) => Promise<void>; onCancel: () => void }) {
  const { category: c } = props;
  const options = props.categories.filter((o) => o.id !== c.id && o.kind === c.kind);
  const [target, setTarget] = useState(options.find((o) => o.id === c.parentId)?.id ?? options[0]?.id ?? '');
  return (
    <form
      className="bg-surface-2 flex flex-wrap items-center gap-2 px-4 py-2 text-sm"
      style={{ paddingLeft: 16 + c.depth * 24 }}
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        void props.onSubmit(target);
      }}
    >
      {c.legCount > 0 ? (
        <>
          <span>
            Delete <strong>{c.name}</strong> and move its {c.legCount} legs to
          </span>
          <select value={target} onChange={(e) => setTarget(e.target.value)} className={`${field} min-w-0`} aria-label="Move legs to">
            {options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.path}
              </option>
            ))}
          </select>
        </>
      ) : (
        <span>
          Delete <strong>{c.name}</strong>? It has no legs.
        </span>
      )}
      <Button variant="danger" type="submit">
        Delete
      </Button>
      <Button type="button" variant="ghost" onClick={props.onCancel}>
        Cancel
      </Button>
    </form>
  );
}
