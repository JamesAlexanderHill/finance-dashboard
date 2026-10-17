import { queryOptions, useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useServerFn } from '@tanstack/react-start';
import { useState, type FormEvent } from 'react';
import { isZero, todayIso } from '@finance/shared';
import { TimeSeriesChart } from '../../components/time-series-chart';
import { Badge, Button, Card, Empty, PageHeader } from '../../components/ui';
import { money, shortDate } from '../../lib/format';
import {
  archiveAccount,
  getAccount,
  getEquity,
  listAccounts,
  pairAccounts,
  unarchiveAccount,
  unpairAccounts,
} from '../../server/accounts.functions';
import { listTransactions } from '../../server/transactions.functions';

const RECENT = 10;

const accountQuery = (id: string) => queryOptions({ queryKey: ['account', id], queryFn: () => getAccount({ data: { id } }) });
const recentQuery = (id: string) =>
  queryOptions({
    queryKey: ['transactions', { accountId: id, recent: RECENT }],
    queryFn: () => listTransactions({ data: { accountId: id, limit: RECENT } }),
  });

export const Route = createFileRoute('/_app/accounts/$accountId')({
  loader: ({ context, params }) =>
    Promise.all([
      context.queryClient.ensureQueryData(accountQuery(params.accountId)),
      context.queryClient.ensureQueryData(recentQuery(params.accountId)),
    ]),
  component: AccountPage,
});

type Detail = Awaited<ReturnType<typeof getAccount>>;

const compact = (n: number) => {
  const abs = Math.abs(n);
  const text = abs >= 1000 ? `${(abs / 1000).toFixed(abs >= 10_000 ? 0 : 1)}k` : abs.toFixed(abs < 10 && abs > 0 ? 2 : 0);
  return `${n < 0 ? '-' : ''}${text}`;
};

function AccountPage() {
  const { accountId } = Route.useParams();
  const { data } = useSuspenseQuery(accountQuery(accountId));
  const { account: a } = data;

  return (
    <>
      <PageHeader
        title={a.name}
        description={
          <>
            {a.institution} · {a.maskedIdentifier} · {a.accountType.replace('_', ' ')} · {a.classification} · {a.commodity} ·{' '}
            <Link to="/accounts" className="underline">
              All accounts
            </Link>
          </>
        }
      />
      <Merges data={data} />
      {!data.mergedInto && <Archive data={data} />}
      <CurrentBalance data={data} />
      {!data.mergedInto && <Pairing data={data} />}
      <BalanceHistory data={data} />
      {!data.mergedInto && <RecentTransactions accountId={accountId} commodity={a.commodity} />}
      <Statements data={data} />
    </>
  );
}

function Merges({ data }: { data: Detail }) {
  const { account: a, mergedInto, mergedIn } = data;
  if (!mergedInto && mergedIn.length === 0 && a.status === 'confirmed') return null;
  return (
    <Card className="mb-4 p-3 text-sm">
      {a.status === 'unconfirmed' && !mergedInto && (
        <p>
          <Badge tone="warning">Unconfirmed</Badge> Found in a statement. Confirm it, or merge it into an existing account, from{' '}
          <Link to="/accounts" className="underline">
            Accounts
          </Link>
          .
        </p>
      )}
      {mergedInto && (
        <p>
          Merged into{' '}
          <Link to="/accounts/$accountId" params={{ accountId: mergedInto.id }} className="underline">
            {mergedInto.name}
          </Link>
          . Its statements still name this account, but their transactions and balances belong to {mergedInto.name}.
        </p>
      )}
      {mergedIn.map((m) => (
        <p key={m.id}>
          Includes statements for{' '}
          <Link to="/accounts/$accountId" params={{ accountId: m.id }} className="underline">
            {m.name}
          </Link>{' '}
          ({m.maskedIdentifier}).
        </p>
      ))}
    </Card>
  );
}

/**
 * Feature 02: archiving closes the account on a date no earlier than its latest activity. It still counts
 * up to that date, is hidden from lists and pickers afterwards, and can be unarchived.
 */
function Archive({ data }: { data: Detail }) {
  const { account: a, balance, latestActivityOn } = data;
  const queryClient = useQueryClient();
  const archive = useServerFn(archiveAccount);
  const unarchive = useServerFn(unarchiveAccount);
  const today = todayIso();
  const [open, setOpen] = useState(false);
  const [closedOn, setClosedOn] = useState(latestActivityOn ?? today);
  const [error, setError] = useState<string | null>(null);

  const run = async (action: () => Promise<unknown>) => {
    setError(null);
    try {
      await action();
      await queryClient.invalidateQueries();
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save');
    }
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void run(() => archive({ data: { id: a.id, closedOn } }));
  };

  if (a.closedOn)
    return (
      <Card className="mb-4 flex flex-wrap items-center gap-3 p-3 text-sm">
        <Badge>Archived</Badge>
        <span className="min-w-48 flex-1">
          Closed on {shortDate(a.closedOn)}. It counts toward net worth up to that date and is hidden from lists after it.
        </span>
        <Button onClick={() => run(() => unarchive({ data: { id: a.id } }))}>Unarchive</Button>
        {error && <p className="text-negative w-full text-xs">{error}</p>}
      </Card>
    );
  if (!open)
    return (
      <div className="mb-4">
        <Button onClick={() => setOpen(true)}>Archive…</Button>
      </div>
    );
  return (
    <Card className="mb-4 p-3 text-sm">
      <form onSubmit={submit} className="flex flex-wrap items-center gap-2">
        <label htmlFor="closed-on">Closed on</label>
        <input
          id="closed-on"
          type="date"
          required
          value={closedOn}
          min={latestActivityOn ?? undefined}
          max={today}
          onChange={(e) => setClosedOn(e.target.value)}
          className="border-line bg-surface rounded border px-2 py-1.5"
        />
        <Button variant="primary" type="submit">
          Archive
        </Button>
        <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </form>
      <p className="text-muted mt-2 text-xs">
        {latestActivityOn ? `Its latest activity is on ${shortDate(latestActivityOn)}, so it cannot close before then. ` : ''}
        Net worth counts it up to the closing date and leaves it out afterwards.
      </p>
      {balance && !isZero(balance.balance) && (
        <p className="text-warning mt-1 text-xs">
          Its last known balance is {money(balance.balance, a.commodity)}, not zero. Archiving leaves that amount out of net worth after the
          closing date.
        </p>
      )}
      {error && <p className="text-negative mt-1 text-xs">{error}</p>}
    </Card>
  );
}

const equityQuery = (id: string) => queryOptions({ queryKey: ['equity', id], queryFn: () => getEquity({ data: { id } }) });
const accountsQuery = queryOptions({ queryKey: ['accounts'], queryFn: () => listAccounts() });
const ROLE = { value: 'Value', loan: 'Loan', offset: 'Offset' } as const;

/**
 * Feature 02: loans and offsets paired with an asset (typically a property) show its equity on the asset's
 * page. A paired account links back to its asset. Display-only: net worth counts every account once.
 */
function Pairing({ data }: { data: Detail }) {
  const { account: a, pairedAsset, paired } = data;
  const queryClient = useQueryClient();
  const unpair = useServerFn(unpairAccounts);
  const [error, setError] = useState<string | null>(null);
  const run = async (action: () => Promise<unknown>) => {
    setError(null);
    try {
      await action();
      await queryClient.invalidateQueries();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save');
    }
  };

  if (pairedAsset)
    return (
      <Card className="mb-4 flex flex-wrap items-center gap-3 p-3 text-sm">
        <span className="min-w-48 flex-1">
          Paired with{' '}
          <Link to="/accounts/$accountId" params={{ accountId: pairedAsset.id }} className="underline">
            {pairedAsset.name}
          </Link>{' '}
          as {a.classification === 'liability' ? 'a loan' : 'an offset'}. Its balance counts in that asset&apos;s equity.
        </span>
        <Button onClick={() => run(() => unpair({ data: { id: a.id } }))}>Unpair</Button>
        {error && <p className="text-negative w-full text-xs">{error}</p>}
      </Card>
    );
  if (a.classification !== 'asset') return null;
  return (
    <section className="mb-4">
      {paired.length > 0 && <Equity accountId={a.id} />}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {paired.map((p) => (
          <span key={p.id} className="border-line inline-flex items-center gap-1 rounded border py-0.5 pr-1 pl-2">
            <span className="text-muted">{p.classification === 'liability' ? 'Loan' : 'Offset'}:</span>
            <Link to="/accounts/$accountId" params={{ accountId: p.id }} className="underline">
              {p.name}
            </Link>
            <Button
              variant="ghost"
              className="px-1.5 py-0"
              aria-label={`Unpair ${p.name}`}
              onClick={() => run(() => unpair({ data: { id: p.id } }))}
            >
              ×
            </Button>
          </span>
        ))}
        <PairPicker data={data} onPair={run} />
      </div>
      {error && <p className="text-negative mt-1 text-xs">{error}</p>}
    </section>
  );
}

function PairPicker({ data, onPair }: { data: Detail; onPair: (action: () => Promise<unknown>) => Promise<void> }) {
  const { account: a } = data;
  const pair = useServerFn(pairAccounts);
  const [open, setOpen] = useState(false);
  const [choice, setChoice] = useState('');
  const accounts = useQuery({ ...accountsQuery, enabled: open });
  if (!open)
    return (
      <Button variant="ghost" onClick={() => setOpen(true)}>
        Pair a loan or offset…
      </Button>
    );
  // An account pairs with one asset, and an asset with pairs of its own cannot be paired.
  const assets = new Set(accounts.data?.flatMap((c) => (c.pairedAssetId ? [c.pairedAssetId] : [])));
  const candidates = (accounts.data ?? []).filter(
    (c) => c.id !== a.id && !c.mergedIntoId && !c.closedOn && !c.pairedAssetId && !assets.has(c.id) && c.commodityKind === 'currency',
  );
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!choice) return;
    void onPair(() => pair({ data: { id: choice, assetId: a.id } })).then(() => {
      setChoice('');
      setOpen(false);
    });
  };
  return (
    <form onSubmit={submit} className="flex flex-wrap items-center gap-2">
      <label htmlFor="pair-account" className="sr-only">
        Loan or offset
      </label>
      <select
        id="pair-account"
        required
        value={choice}
        onChange={(e) => setChoice(e.target.value)}
        className="border-line bg-surface max-w-full rounded border px-2 py-1.5"
      >
        <option value="">{accounts.isLoading ? 'Loading…' : 'Choose a loan or offset'}</option>
        {candidates.map((c) => (
          <option key={c.id} value={c.id}>
            {c.classification === 'liability' ? 'Loan' : 'Offset'}: {c.institution} · {c.name} ({c.maskedIdentifier})
          </option>
        ))}
      </select>
      <Button variant="primary" type="submit">
        Pair
      </Button>
      <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
        Cancel
      </Button>
    </form>
  );
}

function Equity({ accountId }: { accountId: string }) {
  const { data } = useQuery(equityQuery(accountId));
  if (!data) return <Card className="text-muted mb-3 p-4 text-sm">Loading equity…</Card>;
  const { now, series } = data;
  const points = series.filter((p) => p.equity !== null);
  return (
    <Card className="mb-3 p-4">
      <div className="text-muted text-xs">Equity today</div>
      <div className="flex flex-wrap items-baseline gap-2">
        <span className={`tabular text-lg font-semibold ${now.equity?.startsWith('-') ? 'text-negative' : ''}`}>{money(now.equity)}</span>
        {now.partial ? <Badge tone="warning">Partial</Badge> : now.stale ? <Badge tone="warning">Stale</Badge> : null}
      </div>
      <table className="mt-2 w-full max-w-md text-sm">
        <tbody>
          {now.inputs.map((i) => (
            <tr key={i.id} className="border-line border-b last:border-0">
              <td className="text-muted py-1 pr-2">{ROLE[i.role]}</td>
              <td className="py-1 pr-2">
                {i.name}
                {i.notes.length > 0 && <span className="text-muted text-xs"> · {i.notes.join('; ')}</span>}
              </td>
              <td className="tabular py-1 text-right">{i.status === 'closed' ? 'closed' : money(i.aud)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-muted mt-1 text-xs">
        Value less loans plus offsets, each valued as net worth values it. Net worth already counts each account once, so pairing changes no
        total.
      </p>
      {points.length > 0 && (
        <div className="mt-3">
          <TimeSeriesChart
            title="Equity (AUD)"
            kind="line"
            showDots
            domain={[series[0]!.on, series.at(-1)!.on]}
            formatAxis={compact}
            points={points.map((p) => ({
              on: p.on,
              value: Number(p.equity),
              label: `${money(p.equity)}${p.partial ? ' · partial' : p.stale ? ' · stale' : ''}`,
            }))}
          />
          <details className="mt-3">
            <summary className="text-muted cursor-pointer text-sm">Table view</summary>
            <div className="mt-2 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-muted text-left text-xs">
                  <tr className="border-line border-b">
                    <th className="px-2 py-2 font-medium">Date</th>
                    <th className="px-2 py-2 text-right font-medium">Value</th>
                    <th className="px-2 py-2 text-right font-medium">Loans</th>
                    <th className="px-2 py-2 text-right font-medium">Offsets</th>
                    <th className="px-2 py-2 text-right font-medium">Equity</th>
                  </tr>
                </thead>
                <tbody>
                  {series.toReversed().map((p) => (
                    <tr key={p.on} className="border-line border-b last:border-0">
                      <td className="tabular px-2 py-1.5 whitespace-nowrap">{shortDate(p.on)}</td>
                      <td className="tabular px-2 py-1.5 text-right">{money(p.value)}</td>
                      <td className="tabular px-2 py-1.5 text-right">{money(p.loans)}</td>
                      <td className="tabular px-2 py-1.5 text-right">{money(p.offsets)}</td>
                      <td className="tabular px-2 py-1.5 text-right">
                        {money(p.equity)}
                        {p.partial ? ' · partial' : p.stale ? ' · stale' : ''}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </div>
      )}
    </Card>
  );
}

/** Feature 02: a balance is only shown with where it came from and when; it is never inferred. */
function CurrentBalance({ data }: { data: Detail }) {
  const { account: a, balance } = data;
  return (
    <Card className="mb-4 flex flex-wrap items-center gap-4 p-4">
      <div className="min-w-48 flex-1">
        <div className="text-muted text-xs">Balance</div>
        <div className={`tabular text-lg font-semibold ${balance?.balance.startsWith('-') ? 'text-negative' : ''}`}>
          {money(balance?.balance, a.commodity)}
        </div>
        <div className="text-muted text-xs">
          {balance ? (
            <>
              {balance.kind === 'point' ? 'Value' : `${balance.kind[0]!.toUpperCase()}${balance.kind.slice(1)} balance`} on{' '}
              {shortDate(balance.on)}, {balance.source === 'manual' ? 'entered by hand' : <SourceLink balance={balance} />}
            </>
          ) : (
            'Balance unknown: no live statement reports one.'
          )}
        </div>
      </div>
      {a.instrumentId && (
        <Link to="/accounts/assets/$instrumentId" params={{ instrumentId: a.instrumentId }} className="text-sm underline">
          Price, units and value history
        </Link>
      )}
    </Card>
  );
}

function SourceLink({ balance }: { balance: Detail['balances'][number] }) {
  if (!balance.sourceFileId) return <>from a statement</>;
  return (
    <>
      from{' '}
      <a href={`/api/source-files/${balance.sourceFileId}`} target="_blank" rel="noreferrer" className="underline">
        {balance.fileName}
      </a>
    </>
  );
}

function BalanceHistory({ data }: { data: Detail }) {
  const { account: a, balances, mergedIn } = data;
  // One point per date, oldest first; a closing balance wins over an opening balance on the same day.
  const live = [
    ...new Map(
      balances
        .filter((b) => b.live)
        .toReversed()
        .map((b) => [b.on, b]),
    ).values(),
  ];
  if (balances.length === 0) return null;
  const names = new Map(mergedIn.map((m) => [m.id, m.name]));
  const holding = a.commodityKind === 'instrument';

  return (
    <Card className="mb-4 p-4">
      {live.length > 0 && (
        <TimeSeriesChart
          title={holding ? 'Units reported' : `Reported balance (${a.commodity})`}
          kind="line"
          showDots
          zeroBased={holding}
          domain={[live[0]!.on, live.at(-1)?.on ?? todayIso()]}
          formatAxis={holding ? (n) => String(Math.round(n)) : compact}
          points={live.map((b) => ({ on: b.on, value: Number(b.balance), label: `${money(b.balance, a.commodity)} · ${b.kind}` }))}
        />
      )}
      <p className="text-muted mt-1 text-xs">
        Each point is a balance a statement reported or you entered. The line only joins them; it does not trace the movements in between.
      </p>
      <details className="mt-3">
        <summary className="text-muted cursor-pointer text-sm">Table view</summary>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-muted text-left text-xs">
              <tr className="border-line border-b">
                <th className="px-2 py-2 font-medium">Date</th>
                <th className="px-2 py-2 font-medium">Kind</th>
                <th className="px-2 py-2 text-right font-medium">Balance</th>
                <th className="px-2 py-2 font-medium">Source</th>
              </tr>
            </thead>
            <tbody>
              {balances.map((b) => (
                <tr key={b.id} className={`border-line border-b last:border-0 ${b.live ? '' : 'text-muted line-through'}`}>
                  <td className="tabular px-2 py-1.5">{shortDate(b.on)}</td>
                  <td className="px-2 py-1.5">{b.kind}</td>
                  <td className="tabular px-2 py-1.5 text-right">{money(b.balance, a.commodity)}</td>
                  <td className="px-2 py-1.5">
                    {b.source === 'manual' ? 'Entered by hand' : b.fileName}
                    {names.has(b.accountId) && <span className="text-muted"> · via {names.get(b.accountId)}</span>}
                    {!b.live && <span className="text-muted"> · statement deleted</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </Card>
  );
}

function RecentTransactions({ accountId, commodity }: { accountId: string; commodity: string }) {
  const { data } = useSuspenseQuery(recentQuery(accountId));
  return (
    <section className="mb-4">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h2 className="text-muted text-sm font-medium">Recent transactions</h2>
        {data.hasMore && (
          <Link to="/accounts/transactions" search={{ accountId, status: 'active', page: 0 }} className="text-sm underline">
            All transactions
          </Link>
        )}
      </div>
      <Card>
        {data.rows.length === 0 && <Empty>No active transactions.</Empty>}
        {data.rows.map((t) => (
          <Link
            key={t.id}
            to="/accounts/transactions"
            search={{ id: t.id, status: 'all', page: 0 }}
            className="border-line hover:bg-surface-2 flex items-center gap-4 border-b px-4 py-2 text-sm last:border-0"
          >
            <span className="tabular text-muted w-24 shrink-0">{shortDate(t.postedOn)}</span>
            <span className="min-w-0 flex-1 truncate">{t.description}</span>
            <span className={`tabular ${t.amount.startsWith('-') ? 'text-negative' : ''}`}>{money(t.amount, commodity)}</span>
          </Link>
        ))}
      </Card>
    </section>
  );
}

function Statements({ data }: { data: Detail }) {
  return (
    <section>
      <h2 className="text-muted mb-2 text-sm font-medium">Statements</h2>
      <Card className="overflow-x-auto">
        {data.statements.length === 0 && <Empty>No statement names this account.</Empty>}
        {data.statements.length > 0 && (
          <table className="w-full text-sm">
            <thead className="text-muted text-left text-xs">
              <tr className="border-line border-b">
                <th className="px-4 py-2 font-medium">Period</th>
                <th className="px-4 py-2 font-medium">File</th>
                <th className="px-4 py-2 text-right font-medium">Rows</th>
              </tr>
            </thead>
            <tbody>
              {data.statements.map((s) => (
                <tr key={s.id} className={`border-line border-b last:border-0 ${s.deletedAt ? 'text-muted' : ''}`}>
                  <td className="tabular px-4 py-1.5 whitespace-nowrap">
                    {s.periodStart ? `${shortDate(s.periodStart)} – ${shortDate(s.periodEnd)}` : '—'}
                  </td>
                  <td className="px-4 py-1.5">
                    <a href={`/api/source-files/${s.sourceFileId}`} target="_blank" rel="noreferrer" className="hover:underline">
                      {s.fileName}
                    </a>
                    {s.deletedAt && <span> · deleted</span>}
                  </td>
                  <td className="tabular px-4 py-1.5 text-right">{s.rows}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </section>
  );
}
