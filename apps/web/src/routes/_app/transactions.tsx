import { queryOptions, useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useServerFn } from '@tanstack/react-start';
import { useState } from 'react';
import { z } from 'zod';
import { add, eq } from '@finance/shared';
import { Badge, Button, Card, Empty, PageHeader } from '../../components/ui';
import { flattenTree } from '../../lib/category-tree';
import { money, shortDate } from '../../lib/format';
import { listAccounts } from '../../server/accounts.functions';
import { listCategories } from '../../server/categories.functions';
import {
  getTransactionDetail,
  itemiseTransaction,
  listTransactions,
  setLegCategory,
  setLegTags,
  setSuppression,
  type LegView,
} from '../../server/transactions.functions';

const PAGE = 100;

const searchSchema = z.object({
  /** Show a single transaction (e.g. linked from an event leg). */
  id: z.uuid().optional(),
  accountId: z.uuid().optional(),
  status: z.enum(['active', 'inactive', 'all']).default('active'),
  uncategorised: z.boolean().default(false),
  q: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  page: z.number().int().min(0).default(0),
});
type Search = z.infer<typeof searchSchema>;

const transactionsQuery = (s: Search) =>
  queryOptions({
    queryKey: ['transactions', s],
    queryFn: () =>
      listTransactions({
        data: {
          id: s.id,
          accountId: s.accountId,
          status: s.status,
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

export const Route = createFileRoute('/_app/transactions')({
  validateSearch: searchSchema,
  loaderDeps: ({ search }) => search,
  loader: ({ context, deps }) =>
    Promise.all([
      context.queryClient.ensureQueryData(transactionsQuery(deps)),
      context.queryClient.ensureQueryData(accountsQuery),
      context.queryClient.ensureQueryData(categoriesQuery),
    ]),
  component: TransactionsPage,
});

type Row = Awaited<ReturnType<typeof listTransactions>>['rows'][number];
type Category = ReturnType<typeof flattenTree<Awaited<ReturnType<typeof listCategories>>['categories'][number]>>[number];

function TransactionsPage() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const { data } = useSuspenseQuery(transactionsQuery(search));
  const { data: accounts } = useSuspenseQuery(accountsQuery);
  const { data: cats } = useSuspenseQuery(categoriesQuery);
  const categories = flattenTree(cats.categories);
  const tagNames = new Map(cats.tags.map((t) => [t.id, t.name]));
  const set = (patch: Partial<Search>) => navigate({ search: (prev) => ({ ...prev, id: undefined, page: 0, ...patch }) });

  return (
    <>
      <PageHeader
        title="Transactions"
        description="Canonical transactions across all statements. Categorise each leg; nothing is categorised automatically."
      />
      <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
        <select
          value={search.accountId ?? ''}
          onChange={(e) => set({ accountId: e.target.value || undefined })}
          className="border-line bg-surface rounded border px-2 py-1.5"
        >
          <option value="">All accounts</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.institution} · {a.name}
            </option>
          ))}
        </select>
        <select
          value={search.status}
          onChange={(e) => set({ status: e.target.value as Search['status'] })}
          className="border-line bg-surface rounded border px-2 py-1.5"
        >
          <option value="active">Active</option>
          <option value="inactive">Inactive / suppressed</option>
          <option value="all">All</option>
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

      <Card>
        {data.rows.length === 0 && <Empty>No transactions match.</Empty>}
        {data.rows.map((row) => (
          <TransactionRow key={row.id} row={row} categories={categories} tagNames={tagNames} />
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

function TransactionRow({ row, categories, tagNames }: { row: Row; categories: Category[]; tagNames: Map<string, string> }) {
  const queryClient = useQueryClient();
  const suppress = useServerFn(setSuppression);
  const [open, setOpen] = useState(false);
  const active = row.isSourceSupported && !row.isSuppressed;
  const refresh = () => queryClient.invalidateQueries();

  return (
    <div className={`border-line border-b last:border-0 ${active ? '' : 'opacity-60'}`}>
      <div className="flex flex-wrap items-start gap-x-4 gap-y-2 px-4 py-3">
        <div className="text-muted tabular w-24 shrink-0 text-sm">{shortDate(row.postedOn)}</div>
        <div className="min-w-56 flex-1">
          <button className="text-left text-sm font-medium hover:underline" onClick={() => setOpen((o) => !o)}>
            {row.description}
          </button>
          <div className="text-muted flex flex-wrap gap-2 text-xs">
            <span>{row.accountName}</span>
            {row.sourceCount > 1 && <span>{row.sourceCount} sources</span>}
            {row.isSuppressed && <Badge tone="warning">Suppressed</Badge>}
            {!row.isSourceSupported && <Badge>No active statement</Badge>}
          </div>
        </div>
        <div className={`tabular w-28 text-right text-sm ${row.amount.startsWith('-') ? '' : 'text-positive'}`}>
          {money(row.amount, row.commodity)}
        </div>
      </div>
      {active &&
        row.legs.map((leg) => (
          <LegEditor
            key={leg.id}
            transactionId={row.id}
            leg={leg}
            itemised={row.legs.length > 1}
            commodity={row.commodity}
            categories={categories}
            tagNames={tagNames}
          />
        ))}
      {open && (
        <div className="bg-surface-2 px-4 py-3">
          <TransactionDetail row={row} onChange={refresh} />
          <div className="mt-3">
            <Button onClick={() => suppress({ data: { transactionId: row.id, suppressed: !row.isSuppressed } }).then(refresh)}>
              {row.isSuppressed ? 'Restore transaction' : 'Suppress transaction'}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function LegEditor(props: {
  transactionId: string;
  leg: LegView;
  itemised: boolean;
  commodity: string;
  categories: Category[];
  tagNames: Map<string, string>;
}) {
  const { transactionId, leg, categories, tagNames } = props;
  const queryClient = useQueryClient();
  const setCategory = useServerFn(setLegCategory);
  const setTags = useServerFn(setLegTags);
  const currentTags = leg.tagIds
    .map((id) => tagNames.get(id))
    .filter(Boolean)
    .join(', ');
  const [tags, setTagsText] = useState(currentTags);
  const refresh = () => queryClient.invalidateQueries();

  return (
    <div className="flex flex-wrap items-center gap-2 px-4 pb-3 pl-32 text-sm">
      {props.itemised && (
        <span className="text-muted min-w-40">
          {leg.description} · <span className="tabular">{money(leg.amount, props.commodity)}</span>
        </span>
      )}
      <select
        value={leg.categoryId ?? ''}
        onChange={(e) => setCategory({ data: { transactionId, legKey: leg.legKey, categoryId: e.target.value || null } }).then(refresh)}
        className={`border-line bg-surface rounded border px-2 py-1 ${leg.categoryId ? '' : 'text-warning'}`}
        aria-label="Category"
      >
        <option value="">Uncategorised</option>
        {categories.map((c) => (
          <option key={c.id} value={c.id}>
            {'  '.repeat(c.depth)}
            {c.name}
          </option>
        ))}
      </select>
      <input
        value={tags}
        onChange={(e) => setTagsText(e.target.value)}
        onBlur={() => {
          if (tags === currentTags) return;
          const tagNames = tags
            .split(',')
            .map((t) => t.trim())
            .filter(Boolean);
          void setTags({ data: { transactionId, legKey: leg.legKey, tagNames } }).then(refresh);
        }}
        placeholder="Tags, comma separated"
        className="border-line bg-surface min-w-40 rounded border px-2 py-1"
        aria-label="Tags"
      />
    </div>
  );
}

function TransactionDetail({ row, onChange }: { row: Row; onChange: () => void }) {
  const fetchDetail = useServerFn(getTransactionDetail);
  const detail = useQuery({ queryKey: ['transaction', row.id], queryFn: () => fetchDetail({ data: { id: row.id } }) });

  return (
    <div className="grid gap-4 text-sm md:grid-cols-2">
      <div>
        <h3 className="mb-1 font-medium">Sources</h3>
        <ul className="text-muted space-y-1 text-xs">
          {detail.data?.sources.map((s) => (
            <li key={`${s.sourceFileId}:${s.rowIndex}`}>
              <a className="hover:underline" href={`/api/source-files/${s.sourceFileId}`} target="_blank" rel="noreferrer">
                {s.fileName}
              </a>{' '}
              row {s.rowIndex + 1}
              {s.fileDeletedAt && ' (statement deleted)'}
            </li>
          ))}
        </ul>
        {row.isSourceSupported && !row.isSuppressed && <Itemiser row={row} onChange={onChange} />}
      </div>
      <div>
        <h3 className="mb-1 font-medium">Decision history</h3>
        {detail.data?.history.length === 0 && <p className="text-muted text-xs">No decisions yet.</p>}
        <ul className="text-muted space-y-1 text-xs">
          {detail.data?.history.map((h) => (
            <li key={h.id}>
              {new Date(h.createdAt).toLocaleString('en-AU')} · {h.kind}
              {h.legKey && ` (${h.legKey})`} · <code>{h.payload}</code>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function Itemiser({ row, onChange }: { row: Row; onChange: () => void }) {
  const itemise = useServerFn(itemiseTransaction);
  const itemised = row.legs.length > 1;
  const sign = row.amount.startsWith('-') ? '-' : '';
  const [lines, setLines] = useState(() =>
    itemised
      ? row.legs.map((l) => ({ amount: l.amount.replace(/^-/, ''), description: l.description }))
      : [
          { amount: '', description: '' },
          { amount: '', description: '' },
        ],
  );
  const [error, setError] = useState<string | null>(null);
  const valid = lines.every((l) => /^\d+(\.\d{1,2})?$/.test(l.amount));
  const total = valid ? add(...lines.map((l) => `${sign}${l.amount}`)) : null;

  const save = async (value: typeof lines | null) => {
    setError(null);
    try {
      await itemise({
        data: { transactionId: row.id, lines: value && value.map((l) => ({ amount: `${sign}${l.amount}`, description: l.description })) },
      });
      onChange();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not itemise');
    }
  };

  return (
    <div className="mt-4">
      <h3 className="mb-1 font-medium">Itemise</h3>
      {lines.map((line, i) => (
        <div key={i} className="mb-1 flex gap-2">
          <input
            value={line.description}
            onChange={(e) => setLines(lines.map((l, j) => (j === i ? { ...l, description: e.target.value } : l)))}
            placeholder="Item"
            className="border-line bg-surface flex-1 rounded border px-2 py-1"
          />
          <input
            value={line.amount}
            onChange={(e) => setLines(lines.map((l, j) => (j === i ? { ...l, amount: e.target.value } : l)))}
            placeholder="0.00"
            inputMode="decimal"
            className="border-line bg-surface tabular w-24 rounded border px-2 py-1 text-right"
          />
        </div>
      ))}
      <div className="text-muted mb-2 text-xs">
        Total {total ? money(total) : '—'} of {money(row.amount)} {total && eq(total, row.amount) ? '✓' : ''}
      </div>
      <div className="flex gap-2">
        <Button onClick={() => setLines([...lines, { amount: '', description: '' }])}>Add line</Button>
        <Button variant="primary" disabled={!total || !eq(total, row.amount)} onClick={() => save(lines)}>
          Save itemisation
        </Button>
        {itemised && <Button onClick={() => save(null)}>Undo itemisation</Button>}
      </div>
      {error && <p className="text-negative mt-1 text-xs">{error}</p>}
    </div>
  );
}
