import { queryOptions, useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useServerFn } from '@tanstack/react-start';
import { useState, type FormEvent } from 'react';
import { possibleDuplicates } from '@finance/domain/accounts';
import { todayIso } from '@finance/shared';
import { Badge, Button, Card, Empty, PageHeader } from '../../components/ui';
import { money, shortDate } from '../../lib/format';
import {
  createManualAccount,
  listAccounts,
  listManualBalances,
  mergeAccounts,
  recordManualBalance,
  unmergeAccounts,
  updateAccount,
} from '../../server/accounts.functions';

const accountsQuery = queryOptions({ queryKey: ['accounts'], queryFn: () => listAccounts() });

export const Route = createFileRoute('/_app/accounts/')({
  loader: ({ context }) => context.queryClient.ensureQueryData(accountsQuery),
  component: AccountsPage,
});

type Account = Awaited<ReturnType<typeof listAccounts>>[number];

function AccountsPage() {
  const accounts = useSuspenseQuery(accountsQuery);
  // A merged account is shown inside the account it was merged into.
  const visible = accounts.data.filter((a) => !a.mergedIntoId);
  const groups = Map.groupBy(visible, (a) => a.institution);

  return (
    <>
      <PageHeader
        title="Accounts"
        description="Accounts are created automatically from statements. New ones start unconfirmed until you check them. Add manual accounts for things without statements, such as a house, car or super."
      />
      <AddManualAccount accounts={visible} />
      {accounts.data.length === 0 && (
        <Card>
          <Empty>No accounts yet. They appear when you import a statement.</Empty>
        </Card>
      )}
      <div className="flex flex-col gap-6">
        {[...groups].map(([institution, items]) => (
          <section key={institution}>
            <h2 className="text-muted mb-2 text-sm font-medium">{institution}</h2>
            <Card>
              {items.map((a) => (
                <AccountRow
                  key={a.id}
                  account={a}
                  duplicates={a.provider === 'manual' ? possibleDuplicates(a, visible) : []}
                  mergedIn={accounts.data.filter((m) => m.mergedIntoId === a.id)}
                  mergeTargets={visible.filter((t) => t.id !== a.id && t.institutionId === a.institutionId && t.commodity === a.commodity)}
                />
              ))}
            </Card>
          </section>
        ))}
      </div>
    </>
  );
}

function AccountRow({
  account: a,
  duplicates,
  mergedIn,
  mergeTargets,
}: {
  account: Account;
  duplicates: Account[];
  mergedIn: Account[];
  mergeTargets: Account[];
}) {
  const queryClient = useQueryClient();
  const update = useServerFn(updateAccount);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(a.name);

  const save = async (data: { name?: string; confirm?: boolean }) => {
    await update({ data: { id: a.id, ...data } });
    setEditing(false);
    await queryClient.invalidateQueries({ queryKey: ['accounts'] });
  };

  return (
    <div className="border-line flex flex-wrap items-center gap-4 border-b px-4 py-3 last:border-0">
      <div className="min-w-48 flex-1">
        {editing ? (
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void save({ name });
            }}
          >
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="border-line bg-surface rounded border px-2 py-1 text-sm"
            />
            <Button type="submit">Save</Button>
          </form>
        ) : (
          <div className="flex items-baseline gap-2">
            <Link to="/accounts/$accountId" params={{ accountId: a.id }} className="font-medium hover:underline">
              {a.name}
            </Link>
            <button type="button" className="text-muted text-xs hover:underline" onClick={() => setEditing(true)}>
              Rename
            </button>
          </div>
        )}
        <div className="text-muted text-xs">
          {a.maskedIdentifier} · {a.accountType.replace('_', ' ')} · {a.classification} · {a.activeTransactions} transactions
        </div>
        <DuplicateWarning duplicates={duplicates} />
        <MergedAccounts accounts={mergedIn} />
      </div>
      {a.status === 'unconfirmed' && (
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="warning">Unconfirmed</Badge>
          <Button onClick={() => save({ confirm: true })}>Confirm</Button>
          {mergeTargets.length > 0 && <MergeInto account={a} targets={mergeTargets} />}
        </div>
      )}
      <div className="tabular text-right">
        <div className={a.balance && a.balance.balance.startsWith('-') ? 'text-negative' : ''}>
          {money(a.balance?.balance, a.commodity)}
        </div>
        <div className="text-muted text-xs">{a.balance ? `as of ${shortDate(a.balance.on)}` : 'Balance unknown'}</div>
      </div>
      {a.provider === 'manual' && <ManualValues account={a} />}
    </div>
  );
}

const field = 'border-line bg-surface rounded border px-2 py-1.5 text-sm';

/** ADR 0011: an unconfirmed account that is really an existing one (e.g. a reissued card) is merged into it. */
function MergeInto({ account, targets }: { account: Account; targets: Account[] }) {
  const queryClient = useQueryClient();
  const merge = useServerFn(mergeAccounts);
  const [open, setOpen] = useState(false);
  const [intoId, setIntoId] = useState(targets[0]!.id);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await merge({ data: { id: account.id, intoId } });
      setOpen(false);
      await queryClient.invalidateQueries();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not merge');
    }
  };

  if (!open) return <Button onClick={() => setOpen(true)}>Merge…</Button>;
  return (
    <form onSubmit={submit} className="flex flex-wrap items-center gap-2">
      <select value={intoId} onChange={(e) => setIntoId(e.target.value)} className={field} aria-label="Merge into">
        {targets.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name} ({t.maskedIdentifier})
          </option>
        ))}
      </select>
      <Button variant="primary" type="submit">
        Merge
      </Button>
      <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
        Cancel
      </Button>
      {error && <p className="text-negative w-full text-xs">{error}</p>}
    </form>
  );
}

/** Accounts merged into this one: their statements post here until unmerged. */
function MergedAccounts({ accounts }: { accounts: Account[] }) {
  const queryClient = useQueryClient();
  const unmerge = useServerFn(unmergeAccounts);
  if (accounts.length === 0) return null;
  return (
    <ul className="text-muted mt-1 text-xs">
      {accounts.map((m) => (
        <li key={m.id}>
          Includes statements for {m.name} ({m.maskedIdentifier}).{' '}
          <button
            type="button"
            className="underline"
            onClick={async () => {
              await unmerge({ data: { id: m.id } });
              await queryClient.invalidateQueries();
            }}
          >
            Unmerge
          </button>
        </li>
      ))}
    </ul>
  );
}

/** Feature 12: a manual account that looks like a tracked one would count the same thing twice. */
function DuplicateWarning({ duplicates }: { duplicates: Account[] }) {
  if (duplicates.length === 0) return null;
  const names = duplicates.slice(0, 3).map((d) => `${d.name} (${d.institution})`);
  const more = duplicates.length > 3 ? ` and ${duplicates.length - 3} more` : '';
  return (
    <p className="text-warning mt-1 text-xs">
      May duplicate {names.join(', ')}
      {more}, which statements already track. Both count towards net worth.
    </p>
  );
}

function AddManualAccount({ accounts }: { accounts: Account[] }) {
  const queryClient = useQueryClient();
  const create = useServerFn(createManualAccount);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [classification, setClassification] = useState<'asset' | 'liability'>('asset');
  const [currency, setCurrency] = useState('AUD');
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await create({ data: { name, classification, currency: currency.toUpperCase() } });
      setName('');
      setOpen(false);
      await queryClient.invalidateQueries({ queryKey: ['accounts'] });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the account');
    }
  };

  if (!open)
    return (
      <div className="mb-6">
        <Button onClick={() => setOpen(true)}>Add manual account</Button>
      </div>
    );
  return (
    <Card className="mb-6 p-4">
      <form onSubmit={submit} className="flex flex-wrap items-end gap-2">
        <input
          required
          placeholder="Name, e.g. House"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className={field}
          aria-label="Name"
        />
        <select
          value={classification}
          onChange={(e) => setClassification(e.target.value as 'asset' | 'liability')}
          className={field}
          aria-label="Type"
        >
          <option value="asset">Asset</option>
          <option value="liability">Liability</option>
        </select>
        <input
          value={currency}
          onChange={(e) => setCurrency(e.target.value)}
          maxLength={3}
          className={`${field} w-20`}
          aria-label="Currency"
        />
        <Button variant="primary" type="submit">
          Create
        </Button>
        <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </form>
      <DuplicateWarning duplicates={name.trim() ? possibleDuplicates({ name, classification }, accounts) : []} />
      {error && <p className="text-negative mt-2 text-xs">{error}</p>}
    </Card>
  );
}

/** Records dated values for a manual account; each entry is kept, so history is preserved. */
function ManualValues({ account }: { account: Account }) {
  const queryClient = useQueryClient();
  const record = useServerFn(recordManualBalance);
  const fetchHistory = useServerFn(listManualBalances);
  const [showHistory, setShowHistory] = useState(false);
  const history = useQuery({
    queryKey: ['manual-balances', account.id],
    queryFn: () => fetchHistory({ data: { id: account.id } }),
    enabled: showHistory,
  });
  const [observedOn, setObservedOn] = useState(todayIso());
  const [amount, setAmount] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await record({ data: { accountId: account.id, observedOn, amount } });
      setAmount('');
      await queryClient.invalidateQueries();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save');
    }
  };

  return (
    <div className="w-full">
      <form onSubmit={submit} className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted text-xs">Record value</span>
        <input
          type="date"
          required
          value={observedOn}
          onChange={(e) => setObservedOn(e.target.value)}
          className={field}
          aria-label="Date"
        />
        <input
          required
          inputMode="decimal"
          placeholder={account.classification === 'liability' ? 'Amount owed' : 'Value'}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          className={`${field} tabular w-36`}
          aria-label="Amount"
        />
        <Button type="submit">Save</Button>
        <button type="button" className="text-muted text-xs underline" onClick={() => setShowHistory(!showHistory)}>
          {showHistory ? 'Hide history' : 'History'}
        </button>
      </form>
      {error && <p className="text-negative mt-1 text-xs">{error}</p>}
      {showHistory && (
        <ul className="text-muted mt-1 text-xs">
          {history.data?.length === 0 && <li>No values yet.</li>}
          {history.data?.map((h) => (
            <li key={h.id} className="tabular">
              {shortDate(h.observedOn)}: {money(h.balance, account.commodity)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
