import { queryOptions, useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { z } from 'zod';
import { BulkCategorise, LegCategoryEditor, type Category } from '../../components/leg-category';
import { Badge, Button, Card, Empty, PageHeader } from '../../components/ui';
import { flattenTree } from '../../lib/category-tree';
import { money, shortDate } from '../../lib/format';
import { listAccounts } from '../../server/accounts.functions';
import { listCategories } from '../../server/categories.functions';
import { listEvents } from '../../server/events.functions';

const PAGE = 100;
const TYPES = [
  'income',
  'expense',
  'refund',
  'internal_transfer',
  'currency_conversion',
  'investment_buy',
  'investment_sell',
  'opening_balance',
] as const;

const searchSchema = z.object({
  /** Show a single event (e.g. linked from a transaction). */
  id: z.uuid().optional(),
  accountId: z.uuid().optional(),
  type: z.enum(TYPES).optional(),
  uncategorised: z.boolean().default(false),
  q: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  page: z.number().int().min(0).default(0),
});
type Search = z.infer<typeof searchSchema>;

const eventsQuery = (s: Search) =>
  queryOptions({
    queryKey: ['events', s],
    queryFn: () =>
      listEvents({
        data: {
          id: s.id,
          accountId: s.accountId,
          type: s.type,
          uncategorisedOnly: s.uncategorised,
          search: s.q,
          from: s.from,
          to: s.to,
          limit: PAGE,
          offset: s.page * PAGE,
        },
      }),
  });
const accountsQuery = queryOptions({ queryKey: ['accounts'], queryFn: () => listAccounts() });
const categoriesQuery = queryOptions({ queryKey: ['categories'], queryFn: () => listCategories() });

export const Route = createFileRoute('/_app/events/')({
  validateSearch: searchSchema,
  loaderDeps: ({ search }) => search,
  loader: ({ context, deps }) =>
    Promise.all([
      context.queryClient.ensureQueryData(eventsQuery(deps)),
      context.queryClient.ensureQueryData(accountsQuery),
      context.queryClient.ensureQueryData(categoriesQuery),
    ]),
  component: EventsPage,
});

type EventRow = Awaited<ReturnType<typeof listEvents>>['rows'][number];

function EventsPage() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const { data } = useSuspenseQuery(eventsQuery(search));
  const { data: accounts } = useSuspenseQuery(accountsQuery);
  const { data: cats } = useSuspenseQuery(categoriesQuery);
  const categories = flattenTree(cats.categories);
  const tagNames = new Map(cats.tags.map((t) => [t.id, t.name]));
  const set = (patch: Partial<Search>) => navigate({ search: (prev) => ({ ...prev, id: undefined, page: 0, ...patch }) });
  // The selection belongs to one page of one filter; changing either starts a new one.
  const selectionKey = JSON.stringify(search);
  const [selection, setSelection] = useState<{ key: string; ids: Set<string>; notice?: string }>({ key: selectionKey, ids: new Set() });
  const current = selection.key === selectionKey;
  const selected = current ? selection.ids : new Set<string>();
  const toggle = (ids: string[], on: boolean) => {
    const next = new Set(selected);
    for (const id of ids) on ? next.add(id) : next.delete(id);
    setSelection({ key: selectionKey, ids: next });
  };
  const selectable = data.rows.flatMap((e) => e.legs.filter((l) => l.categorisable));

  return (
    <>
      <PageHeader
        title="Events"
        description="Economic events rebuilt from active transactions and your decisions. Each leg moves one of your accounts. Categorise each leg (and tick identical or similar legs to give them the same category), accept a suggested category, or select several legs and categorise them together; nothing is categorised until you choose."
      />
      <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
        <select
          value={search.accountId ?? ''}
          onChange={(e) => set({ accountId: e.target.value || undefined })}
          className="border-line bg-surface rounded border px-2 py-1.5"
        >
          <option value="">All accounts</option>
          {/* Archived accounts are hidden unless already chosen (feature 02). */}
          {accounts
            .filter((a) => !a.closedOn || a.id === search.accountId)
            .map((a) => (
              <option key={a.id} value={a.id}>
                {a.institution} · {a.name}
                {a.closedOn ? ' (archived)' : ''}
              </option>
            ))}
        </select>
        <select
          value={search.type ?? ''}
          onChange={(e) => set({ type: (e.target.value || undefined) as Search['type'] })}
          className="border-line bg-surface rounded border px-2 py-1.5"
        >
          <option value="">All types</option>
          {TYPES.map((t) => (
            <option key={t} value={t}>
              {t.replace('_', ' ')}
            </option>
          ))}
        </select>
        <input
          type="date"
          value={search.from ?? ''}
          onChange={(e) => set({ from: e.target.value || undefined })}
          className="border-line bg-surface rounded border px-2 py-1"
          aria-label="From"
        />
        <input
          type="date"
          value={search.to ?? ''}
          onChange={(e) => set({ to: e.target.value || undefined })}
          className="border-line bg-surface rounded border px-2 py-1"
          aria-label="To"
        />
        <input
          placeholder="Search description"
          defaultValue={search.q}
          onKeyDown={(e) => e.key === 'Enter' && set({ q: e.currentTarget.value || undefined })}
          className="border-line bg-surface min-w-48 flex-1 rounded border px-2 py-1.5"
        />
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={search.uncategorised} onChange={(e) => set({ uncategorised: e.target.checked })} />
          Uncategorised only
        </label>
      </div>

      {/* Outside the card: categorised events can leave the list, taking the bulk bar with them. */}
      {current && selection.notice && (
        <p className="text-muted mb-2 text-sm" role="status">
          {selection.notice}
        </p>
      )}
      <Card>
        {data.rows.length === 0 && <Empty>No events.</Empty>}
        {selectable.length > 0 && (
          <BulkCategorise
            legs={selectable}
            selected={selected}
            categories={categories}
            onToggleAll={toggle}
            onDone={(notice) => setSelection({ key: selectionKey, ids: new Set(), notice })}
          />
        )}
        {data.rows.map((e) => (
          <EventItem key={e.id} event={e} categories={categories} tagNames={tagNames} selected={selected} onSelect={toggle} />
        ))}
      </Card>
      <div className="mt-4 flex justify-between">
        <Button disabled={search.page === 0} onClick={() => navigate({ search: (p) => ({ ...p, page: p.page - 1 }) })}>
          Previous
        </Button>
        <Button disabled={!data.hasMore} onClick={() => navigate({ search: (p) => ({ ...p, page: p.page + 1 }) })}>
          Next
        </Button>
      </div>
    </>
  );
}

function EventItem(props: {
  event: EventRow;
  categories: Category[];
  tagNames: Map<string, string>;
  selected: Set<string>;
  onSelect: (ids: string[], on: boolean) => void;
}) {
  const { event: e, categories, tagNames } = props;
  return (
    <div className="border-line border-b px-4 py-3 last:border-0">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-muted tabular w-24 text-sm">{shortDate(e.occurredOn)}</span>
        <span className="flex-1 text-sm font-medium">{e.description}</span>
        <Badge tone={e.type === 'income' ? 'positive' : e.type === 'opening_balance' ? 'neutral' : 'warning'}>
          {e.type.replace('_', ' ')}
        </Badge>
        {e.status !== 'ok' && <Badge tone="negative">{e.status.replace('_', ' ')}</Badge>}
      </div>
      <ul className="mt-2 space-y-2 text-sm sm:pl-28">
        {e.legs.map((l) => (
          <li key={l.id} className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="w-4 shrink-0">
              {l.categorisable && (
                <input
                  type="checkbox"
                  checked={props.selected.has(l.id)}
                  onChange={(ev) => props.onSelect([l.id], ev.target.checked)}
                  aria-label={`Select ${l.description}`}
                />
              )}
            </span>
            <span className="text-muted w-56 truncate text-xs">
              {l.accountName} · {l.role.replace('_', ' ')}
              {l.role === 'line_item' && ` · ${l.description}`}
            </span>
            <span className={`tabular w-28 text-right ${l.amount.startsWith('-') ? '' : 'text-positive'}`}>
              {money(l.amount, l.commodity)}
            </span>
            {e.type === 'opening_balance' ? null : <LegCategoryEditor key={l.id} leg={l} categories={categories} tagNames={tagNames} />}
            {l.transactionId && (
              <Link
                to="/accounts/transactions"
                search={{ id: l.transactionId, status: 'all', page: 0 }}
                className="text-muted text-xs hover:underline"
              >
                transaction
              </Link>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
