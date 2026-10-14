import { queryOptions, useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useServerFn } from '@tanstack/react-start';
import { useRef, useState } from 'react';
import { z } from 'zod';
import { add, eq } from '@finance/shared';
import { Badge, Button, Card, Empty, PageHeader } from '../../components/ui';
import { flattenTree } from '../../lib/category-tree';
import { money, shortDate } from '../../lib/format';
import { listAccounts } from '../../server/accounts.functions';
import { listCategories } from '../../server/categories.functions';
import { findLinkCandidates, linkTransactions, setTransferMark, unlinkTransaction } from '../../server/transfers.functions';
import {
  acceptCategorySuggestions,
  getTransactionDetail,
  itemiseTransaction,
  listTransactions,
  setCategoryForLegs,
  setLegCategory,
  setLegTags,
  setReceiptRemoval,
  setSuppression,
  type EventView,
  type LegView,
} from '../../server/transactions.functions';

const EVENT_LABELS: Record<string, string> = {
  internal_transfer: 'Transfer',
  currency_conversion: 'Conversion',
  refund: 'Refund',
};

function EventBadge({ event }: { event: EventView | null }) {
  if (!event) return null;
  if (event.status === 'unmatched_transfer') return <Badge tone="warning">Unmatched transfer</Badge>;
  const label = EVENT_LABELS[event.type];
  if (!label && event.members < 2) return null;
  return <Badge>{label ?? `${event.members}-part ${event.type}`}</Badge>;
}

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

/** Legs that can carry a category: everything except the principal legs of internal events. */
const categorisable = (row: Row) => row.legs.filter((l) => !row.event?.isInternal || l.role === 'fee');
/** Itemised rows are left out of bulk selection: their lines usually need different categories. */
const selectable = (row: Row) => row.isSourceSupported && !row.isSuppressed && row.legs.length === 1 && categorisable(row).length > 0;
/** Uncategorised legs with a suggestion (feature 14); suggestions are derived from earlier decisions, never stored. */
const suggested = (row: Row) => categorisable(row).filter((l) => !l.categoryId && l.suggestedCategoryId);

function TransactionsPage() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const { data } = useSuspenseQuery(transactionsQuery(search));
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

  return (
    <>
      <PageHeader
        title="Transactions"
        description="Canonical transactions across all statements. Categorise each leg, accept a suggested category, or select several and categorise them together; nothing is categorised until you choose."
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

      {/* Outside the card: categorised rows can leave the list, taking the bulk bar with them. */}
      {current && selection.notice && (
        <p className="text-muted mb-2 text-sm" role="status">
          {selection.notice}
        </p>
      )}
      <Card>
        {data.rows.length === 0 && <Empty>No transactions match.</Empty>}
        {data.rows.length > 0 && (
          <BulkCategorise
            rows={data.rows}
            selected={selected}
            categories={categories}
            onToggleAll={toggle}
            onDone={(notice) => setSelection({ key: selectionKey, ids: new Set(), notice })}
          />
        )}
        {data.rows.map((row) => (
          <TransactionRow
            key={row.id}
            row={row}
            categories={categories}
            tagNames={tagNames}
            selected={selected.has(row.id)}
            onSelect={(on) => toggle([row.id], on)}
          />
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

/** Gives the selected transactions one category in a single step. It is manual: nothing applies to later imports. */
function BulkCategorise(props: {
  rows: Row[];
  selected: Set<string>;
  categories: Category[];
  onToggleAll: (ids: string[], on: boolean) => void;
  onDone: (notice?: string) => void;
}) {
  const { rows, selected } = props;
  const queryClient = useQueryClient();
  const apply = useServerFn(setCategoryForLegs);
  const accept = useServerFn(acceptCategorySuggestions);
  const [categoryId, setCategoryId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ids = rows.filter(selectable).map((r) => r.id);
  const allOn = ids.length > 0 && ids.every((id) => selected.has(id));
  const chosen = rows.filter((r) => selected.has(r.id));
  const suggestions = chosen.flatMap((r) => suggested(r).map((l) => ({ transactionId: r.id, legKey: l.legKey })));

  const run = async (fn: () => Promise<{ categorised: number }>) => {
    setBusy(true);
    setError(null);
    try {
      const { categorised } = await fn();
      await queryClient.invalidateQueries();
      props.onDone(`Categorised ${categorised} ${categorised === 1 ? 'leg' : 'legs'}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not categorise');
    } finally {
      setBusy(false);
    }
  };
  const save = () =>
    run(() => {
      const legs = chosen.flatMap((r) => categorisable(r).map((l) => ({ transactionId: r.id, legKey: l.legKey })));
      return apply({ data: { legs, categoryId: categoryId === 'none' ? null : categoryId } });
    });

  return (
    <div className="border-line bg-surface sticky top-0 z-10 flex flex-wrap items-center gap-2 rounded-t-lg border-b px-4 py-2 text-sm">
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={allOn} disabled={ids.length === 0} onChange={(e) => props.onToggleAll(ids, e.target.checked)} />
        {selected.size > 0 ? `${selected.size} selected` : 'Select all on this page'}
      </label>
      {selected.size > 0 && (
        <>
          <select
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            className="border-line bg-surface min-w-0 rounded border px-2 py-1"
            aria-label="Category for selected"
          >
            <option value="">Choose a category…</option>
            <option value="none">Uncategorised</option>
            {props.categories.map((c) => (
              <option key={c.id} value={c.id}>
                {'  '.repeat(c.depth)}
                {c.name}
              </option>
            ))}
          </select>
          <Button variant="primary" disabled={!categoryId || busy} onClick={save}>
            Categorise {selected.size}
          </Button>
          {suggestions.length > 0 && (
            <Button disabled={busy} onClick={() => run(() => accept({ data: { legs: suggestions } }))}>
              Accept {suggestions.length} {suggestions.length === 1 ? 'suggestion' : 'suggestions'}
            </Button>
          )}
          <Button variant="ghost" onClick={() => props.onDone()}>
            Clear
          </Button>
        </>
      )}
      {error && <span className="text-negative text-xs">{error}</span>}
    </div>
  );
}

function TransactionRow(props: {
  row: Row;
  categories: Category[];
  tagNames: Map<string, string>;
  selected: boolean;
  onSelect: (on: boolean) => void;
}) {
  const { row, categories, tagNames } = props;
  const queryClient = useQueryClient();
  const suppress = useServerFn(setSuppression);
  const unlink = useServerFn(unlinkTransaction);
  const markTransfer = useServerFn(setTransferMark);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const active = row.isSourceSupported && !row.isSuppressed;
  const refresh = () => queryClient.invalidateQueries();
  const act = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    }
  };

  return (
    <div className={`border-line border-b last:border-0 ${active ? '' : 'opacity-60'}`}>
      <div className="flex flex-wrap items-start gap-x-4 gap-y-2 px-4 py-3">
        <span className="w-4 shrink-0 pt-0.5">
          {selectable(row) && (
            <input
              type="checkbox"
              checked={props.selected}
              onChange={(e) => props.onSelect(e.target.checked)}
              aria-label={`Select ${row.description}`}
            />
          )}
        </span>
        <div className="text-muted tabular w-24 shrink-0 text-sm">{shortDate(row.postedOn)}</div>
        <div className="min-w-56 flex-1">
          <button className="text-left text-sm font-medium hover:underline" onClick={() => setOpen((o) => !o)}>
            {row.description}
          </button>
          <div className="text-muted flex flex-wrap gap-2 text-xs">
            <span>{row.accountName}</span>
            {row.sourceCount > 1 && <span>{row.sourceCount} sources</span>}
            {row.receiptCount > 0 && <span>{row.receiptCount === 1 ? '1 receipt' : `${row.receiptCount} receipts`}</span>}
            <EventBadge event={row.event} />
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
            internal={!!row.event?.isInternal}
            commodity={row.commodity}
            categories={categories}
            tagNames={tagNames}
          />
        ))}
      {open && (
        <div className="bg-surface-2 px-4 py-3">
          <TransactionDetail row={row} onChange={refresh} />
          <div className="mt-3 flex flex-wrap gap-2">
            <Button onClick={() => act(() => suppress({ data: { transactionId: row.id, suppressed: !row.isSuppressed } }))}>
              {row.isSuppressed ? 'Restore transaction' : 'Suppress transaction'}
            </Button>
            {active && row.isLinked && (
              <Button onClick={() => act(() => unlink({ data: { transactionId: row.id } }))}>Unlink transfer</Button>
            )}
            {active && !row.isLinked && row.event?.members === 1 && (
              <Button
                onClick={() =>
                  act(() => markTransfer({ data: { transactionId: row.id, isTransfer: row.event?.status !== 'unmatched_transfer' } }))
                }
              >
                {row.event?.status === 'unmatched_transfer' ? 'Not a transfer' : 'Mark as transfer'}
              </Button>
            )}
          </div>
          {error && <p className="text-negative mt-2 text-xs">{error}</p>}
        </div>
      )}
    </div>
  );
}

function LegEditor(props: {
  transactionId: string;
  leg: LegView;
  itemised: boolean;
  internal: boolean;
  commodity: string;
  categories: Category[];
  tagNames: Map<string, string>;
}) {
  const { transactionId, leg, categories, tagNames } = props;
  const queryClient = useQueryClient();
  const setCategory = useServerFn(setLegCategory);
  const accept = useServerFn(acceptCategorySuggestions);
  const setTags = useServerFn(setLegTags);
  const suggestion = !leg.categoryId && leg.suggestedCategoryId ? categories.find((c) => c.id === leg.suggestedCategoryId) : undefined;
  const currentTags = leg.tagIds
    .map((id) => tagNames.get(id))
    .filter(Boolean)
    .join(', ');
  const [tags, setTagsText] = useState(currentTags);
  const refresh = () => queryClient.invalidateQueries();

  return (
    <div className="flex flex-wrap items-center gap-2 px-4 pb-3 pl-40 text-sm">
      {props.itemised && (
        <span className="text-muted min-w-40">
          {leg.description} · <span className="tabular">{money(leg.amount, props.commodity)}</span>
        </span>
      )}
      {leg.role === 'fee' && <span className="text-muted">Fee</span>}
      {props.internal && leg.role !== 'fee' ? (
        <span className="text-muted">Moves money between your accounts; not categorised</span>
      ) : (
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
      )}
      {suggestion && (
        <span className="text-muted text-xs">
          Suggested: {suggestion.path}{' '}
          <button
            className="hover:text-ink underline"
            onClick={() => accept({ data: { legs: [{ transactionId, legKey: leg.legKey }] } }).then(refresh)}
          >
            Accept
          </button>
        </span>
      )}
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
        <Receipts transactionId={row.id} receipts={detail.data?.receipts} onChange={onChange} />
        {row.isSourceSupported && !row.isSuppressed && !row.event?.isInternal && row.legs[0]?.role !== 'fee' && (
          <Itemiser row={row} onChange={onChange} />
        )}
        {row.isSourceSupported && !row.isSuppressed && <LinkPicker row={row} onChange={onChange} />}
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

type Receipt = NonNullable<Awaited<ReturnType<typeof getTransactionDetail>>>['receipts'][number];

const fileSize = (bytes: number) =>
  bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

/** Receipts are kept as evidence for the transaction (e.g. for itemising it); they are never read automatically. */
function Receipts({ transactionId, receipts, onChange }: { transactionId: string; receipts?: Receipt[]; onChange: () => void }) {
  const setRemoval = useServerFn(setReceiptRemoval);
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const upload = async (file?: File) => {
    if (!file) return;
    setError(null);
    setBusy(true);
    const body = new FormData();
    body.append('transactionId', transactionId);
    body.append('file', file);
    try {
      const res = await fetch('/api/receipts', { method: 'POST', body });
      const data = (await res.json()) as { error?: string };
      if (data.error) setError(data.error);
      else onChange();
    } catch {
      setError('Could not upload the receipt');
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };
  const toggle = async (r: Receipt) => {
    setError(null);
    try {
      await setRemoval({ data: { sourceFileId: r.sourceFileId, removed: !r.removedAt } });
      onChange();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    }
  };

  return (
    <div className="mt-4">
      <h3 className="mb-1 font-medium">Receipts</h3>
      {receipts?.length === 0 && (
        <p className="text-muted mb-2 text-xs">No receipts. Attach a PDF or photo as evidence for this transaction.</p>
      )}
      <ul className="mb-2 space-y-1 text-xs">
        {receipts?.map((r) => (
          <li key={r.sourceFileId} className={`flex flex-wrap items-center gap-x-2 ${r.removedAt ? 'text-muted' : ''}`}>
            <a className="min-w-0 truncate hover:underline" href={`/api/source-files/${r.sourceFileId}`} target="_blank" rel="noreferrer">
              {r.fileName}
            </a>
            <span className="text-muted">
              {fileSize(r.sizeBytes)}
              {r.removedAt && ' · removed'}
            </span>
            <button className="text-muted hover:text-ink underline" onClick={() => toggle(r)}>
              {r.removedAt ? 'Restore' : 'Remove'}
            </button>
          </li>
        ))}
      </ul>
      <input
        ref={input}
        type="file"
        accept="application/pdf,image/jpeg,image/png,image/webp"
        hidden
        onChange={(e) => upload(e.target.files?.[0])}
      />
      <Button disabled={busy} onClick={() => input.current?.click()}>
        {busy ? 'Uploading…' : 'Attach receipt'}
      </Button>
      {error && <p className="text-negative mt-1 text-xs">{error}</p>}
    </div>
  );
}

/** Links this transaction with one in another account, e.g. the two sides of a transfer whose amounts differ. */
function LinkPicker({ row, onChange }: { row: Row; onChange: () => void }) {
  const fetchCandidates = useServerFn(findLinkCandidates);
  const link = useServerFn(linkTransactions);
  const candidates = useQuery({ queryKey: ['link-candidates', row.id], queryFn: () => fetchCandidates({ data: { id: row.id } }) });
  const [selected, setSelected] = useState('');
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setError(null);
    try {
      await link({ data: { transactionIds: [row.id, selected] } });
      setSelected('');
      onChange();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not link');
    }
  };

  return (
    <div className="mt-4">
      <h3 className="mb-1 font-medium">Link with another account</h3>
      <p className="text-muted mb-2 text-xs">
        Joins both transactions into one event, e.g. a transfer or loan drawdown whose sides differ.
      </p>
      <div className="flex flex-wrap gap-2">
        <select
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          className="border-line bg-surface max-w-full min-w-0 flex-1 rounded border px-2 py-1"
          aria-label="Transaction to link"
        >
          <option value="">{candidates.data?.length === 0 ? 'No transactions within two weeks' : 'Choose a transaction…'}</option>
          {candidates.data?.map((c) => (
            <option key={c.id} value={c.id}>
              {shortDate(c.postedOn)} · {c.accountName} · {money(c.amount, c.commodity)} · {c.description}
            </option>
          ))}
        </select>
        <Button disabled={!selected} onClick={save}>
          Link
        </Button>
      </div>
      {error && <p className="text-negative mt-1 text-xs">{error}</p>}
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
