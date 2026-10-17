import { queryOptions, useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { useServerFn } from '@tanstack/react-start';
import { useRef, useState } from 'react';
import { z } from 'zod';
import { add, eq } from '@finance/shared';
import { Badge, Button, Card, Empty, PageHeader } from '../../components/ui';
import { money, shortDate } from '../../lib/format';
import { listAccounts } from '../../server/accounts.functions';
import { findLinkCandidates, linkTransactions, setTransferMark, unlinkTransaction } from '../../server/transfers.functions';
import {
  getTransactionDetail,
  listTransactions,
  saveLineItems,
  setReceiptRemoval,
  setSuppression,
  type EventView,
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
          search: s.q,
          from: s.from,
          to: s.to,
          limit: PAGE,
          offset: s.page * PAGE,
        },
      }),
  });
const accountsQuery = queryOptions({ queryKey: ['accounts'], queryFn: () => listAccounts() });

export const Route = createFileRoute('/_app/accounts/transactions')({
  validateSearch: searchSchema,
  loaderDeps: ({ search }) => search,
  loader: ({ context, deps }) =>
    Promise.all([context.queryClient.ensureQueryData(transactionsQuery(deps)), context.queryClient.ensureQueryData(accountsQuery)]),
  component: TransactionsPage,
});

type Row = Awaited<ReturnType<typeof listTransactions>>['rows'][number];
function TransactionsPage() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const { data } = useSuspenseQuery(transactionsQuery(search));
  const { data: accounts } = useSuspenseQuery(accountsQuery);
  const set = (patch: Partial<Search>) => navigate({ search: (prev) => ({ ...prev, id: undefined, page: 0, ...patch }) });

  return (
    <>
      <PageHeader
        title="Transactions"
        description="Canonical transactions exactly as your statements report them. Add line items to split one into parts; categories are given to the legs of its event on the Events page."
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
      </div>

      <Card>
        {data.rows.length === 0 && <Empty>No transactions match.</Empty>}
        {data.rows.map((row) => (
          <TransactionRow key={row.id} row={row} />
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

function TransactionRow({ row }: { row: Row }) {
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
      {active && row.event && <LegSummary row={row} />}
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

/** The legs this transaction gives its event, read-only: categories are set on the Events page. */
function LegSummary({ row }: { row: Row }) {
  const internal = !!row.event?.isInternal;
  return (
    <ul className="text-muted space-y-0.5 px-4 pb-3 pl-32 text-xs">
      {row.legs.map((leg) => (
        <li key={leg.id} className="flex flex-wrap gap-x-3">
          {leg.role === 'line_item' && (
            <span className="min-w-40">
              {leg.description} · <span className="tabular">{money(leg.amount, row.commodity)}</span>
            </span>
          )}
          {leg.role === 'fee' && <span>Fee</span>}
          <span className={leg.categoryName || (internal && leg.role !== 'fee') ? '' : 'text-warning'}>
            {internal && leg.role !== 'fee' ? 'Moves money between your accounts' : (leg.categoryName ?? 'Uncategorised')}
          </span>
          <Link to="/events" search={{ id: row.event!.id, uncategorised: false, page: 0 }} className="hover:text-ink underline">
            {internal && leg.role !== 'fee' ? 'view event' : 'categorise in event'}
          </Link>
        </li>
      ))}
    </ul>
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
          <LineItems row={row} onChange={onChange} />
        )}
        {row.isSourceSupported && !row.isSuppressed && <LinkPicker row={row} onChange={onChange} />}
      </div>
      <div>
        <h3 className="mb-1 font-medium">History</h3>
        {detail.data?.history.length === 0 && <p className="text-muted text-xs">No decisions or categories yet.</p>}
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

/**
 * The transaction's line items (feature 05). They must sum exactly to its amount; each becomes its own
 * leg. Lines keep their identity when edited, so a line's category survives changes to the others.
 */
function LineItems({ row, onChange }: { row: Row; onChange: () => void }) {
  const save = useServerFn(saveLineItems);
  const itemised = row.lineItems.length > 0;
  const sign = row.amount.startsWith('-') ? '-' : '';
  const [lines, setLines] = useState<Array<{ id?: string; amount: string; description: string }>>(() =>
    itemised
      ? row.lineItems.map((l) => ({
          id: l.id,
          amount: l.amount
            .replace(/^-/, '')
            .replace(/(\.\d*?)0+$/, '$1')
            .replace(/\.$/, ''),
          description: l.description,
        }))
      : [
          { amount: '', description: '' },
          { amount: '', description: '' },
        ],
  );
  const [error, setError] = useState<string | null>(null);
  const valid = lines.length >= 2 && lines.every((l) => /^\d+(\.\d{1,2})?$/.test(l.amount));
  const total = valid ? add(...lines.map((l) => `${sign}${l.amount}`)) : null;

  const submit = async (value: typeof lines | null) => {
    setError(null);
    try {
      await save({
        data: {
          transactionId: row.id,
          lines: value && value.map((l) => ({ id: l.id, amount: `${sign}${l.amount}`, description: l.description })),
        },
      });
      onChange();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save line items');
    }
  };

  return (
    <div className="mt-4">
      <h3 className="mb-1 font-medium">Line items</h3>
      <p className="text-muted mb-2 text-xs">
        Split the transaction into parts, e.g. from a receipt. Each part becomes its own leg to categorise.
      </p>
      {lines.map((line, i) => (
        <div key={line.id ?? `new-${i}`} className="mb-1 flex gap-2">
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
          <Button
            variant="ghost"
            disabled={lines.length <= 2}
            onClick={() => setLines(lines.filter((_, j) => j !== i))}
            aria-label="Remove line"
          >
            ×
          </Button>
        </div>
      ))}
      <div className="text-muted mb-2 text-xs">
        Total {total ? money(total) : '—'} of {money(row.amount)} {total && eq(total, row.amount) ? '✓' : ''}
      </div>
      <div className="flex gap-2">
        <Button onClick={() => setLines([...lines, { amount: '', description: '' }])}>Add line</Button>
        <Button variant="primary" disabled={!total || !eq(total, row.amount)} onClick={() => submit(lines)}>
          Save line items
        </Button>
        {itemised && <Button onClick={() => submit(null)}>Remove line items</Button>}
      </div>
      {error && <p className="text-negative mt-1 text-xs">{error}</p>}
    </div>
  );
}
