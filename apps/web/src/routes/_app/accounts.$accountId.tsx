import { queryOptions, useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { todayIso } from '@finance/shared';
import { TimeSeriesChart } from '../../components/time-series-chart';
import { Badge, Card, Empty, PageHeader } from '../../components/ui';
import { money, shortDate } from '../../lib/format';
import { getAccount } from '../../server/accounts.functions';
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
      <CurrentBalance data={data} />
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
        <Link to="/holdings/$instrumentId" params={{ instrumentId: a.instrumentId }} className="text-sm underline">
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
          <Link to="/transactions" search={{ accountId, status: 'active', uncategorised: false, page: 0 }} className="text-sm underline">
            All transactions
          </Link>
        )}
      </div>
      <Card>
        {data.rows.length === 0 && <Empty>No active transactions.</Empty>}
        {data.rows.map((t) => (
          <Link
            key={t.id}
            to="/transactions"
            search={{ id: t.id, status: 'all', uncategorised: false, page: 0 }}
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
