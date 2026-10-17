import { queryOptions, useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { add } from '@finance/shared';
import { Badge, Card, Empty, PageHeader } from '../../components/ui';
import { money, shortDate } from '../../lib/format';
import { listHoldings } from '../../server/holdings.functions';

const holdingsQuery = queryOptions({ queryKey: ['holdings'], queryFn: () => listHoldings() });

export const Route = createFileRoute('/_app/accounts/assets/')({
  loader: ({ context }) => context.queryClient.ensureQueryData(holdingsQuery),
  component: HoldingsPage,
});

const units = (q: string) => (Number(q) === Math.trunc(Number(q)) ? String(Math.trunc(Number(q))) : q.replace(/0+$/, ''));

function HoldingsPage() {
  const { data } = useSuspenseQuery(holdingsQuery);
  const held = data.filter((h) => Number(h.units) !== 0);
  const valued = held.filter((h) => h.aud !== null);
  const total = add('0', ...valued.map((h) => h.aud!));
  const missing = held.length - valued.length;
  const stale = held.some((h) => h.stale);

  return (
    <>
      <PageHeader
        title="Holdings"
        description="Units held per instrument across accounts, valued today in AUD. A price or rate older than the previous business day's close is stale; nothing is estimated."
      />
      <Card className="mb-4 p-4">
        <div className="text-muted flex items-center gap-2 text-xs">Holdings value {stale && <Badge tone="warning">Stale</Badge>}</div>
        <div className="tabular text-2xl font-semibold">{money(total)}</div>
        {missing > 0 && (
          <div className="text-warning text-xs">Partial: {missing} holding(s) have no price or FX rate and are excluded.</div>
        )}
      </Card>
      <Card>
        {data.length === 0 && <Empty>No holdings yet. Import an investment statement to see them.</Empty>}
        {data.map((h) => (
          <div key={h.id} className="border-line border-b px-4 py-3 last:border-0">
            <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
              <Link to="/accounts/assets/$instrumentId" params={{ instrumentId: h.id }} className="min-w-48 flex-1 hover:underline">
                <span className="font-medium">{h.symbol}</span> <span className="text-muted text-sm">{h.name}</span>
              </Link>
              <span className="tabular text-sm">{units(h.units)} units</span>
              <span className="text-muted tabular text-sm">
                {h.price ? `${money(h.price.price, h.currency)} on ${shortDate(h.price.on)}` : 'No price'}
              </span>
              {h.price?.tradePriced && <Badge tone="warning">Trade-priced</Badge>}
              {h.stale && <Badge tone="warning">Stale</Badge>}
              <span className="tabular w-36 text-right">
                <span className="font-medium">{h.aud ? money(h.aud) : '—'}</span>
                {h.currency !== 'AUD' && h.value && <span className="text-muted block text-xs">{money(h.value, h.currency)}</span>}
              </span>
            </div>
            {h.notes.length > 0 && <p className="text-muted mt-1 text-xs">{h.notes.join(' · ')}</p>}
            {h.override && (
              <p className="mt-1 text-xs">
                <Badge>Override</Badge>{' '}
                <span className="text-muted">
                  At your price of {money(h.override.price, h.currency)} this would be {money(h.override.value, h.currency)} (display only,
                  not in any total).
                </span>
              </p>
            )}
            {h.accounts.length > 1 && (
              <ul className="text-muted mt-1 text-xs">
                {h.accounts.map((a) => (
                  <li key={a.id}>
                    {a.institution} · {a.name}: {units(a.units)} units
                  </li>
                ))}
              </ul>
            )}
            {h.accounts.some((a) => a.mismatches.length) && (
              <p className="text-warning mt-1 text-xs">
                A statement&apos;s reported quantity disagrees with the transactions. Open it for details.
              </p>
            )}
          </div>
        ))}
      </Card>
    </>
  );
}
