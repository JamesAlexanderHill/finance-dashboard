import { queryOptions, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useServerFn } from '@tanstack/react-start';
import { useState, type FormEvent } from 'react';
import { todayIso } from '@finance/shared';
import { TimeSeriesChart } from '../../components/time-series-chart';
import { Badge, Button, Card, PageHeader } from '../../components/ui';
import { money, shortDate } from '../../lib/format';
import { clearOverride, getInstrumentHistory, setOverride } from '../../server/holdings.functions';

const historyQuery = (id: string) =>
  queryOptions({ queryKey: ['instrument-history', id], queryFn: () => getInstrumentHistory({ data: { id } }) });

export const Route = createFileRoute('/_app/assets/$instrumentId')({
  loader: ({ context, params }) => context.queryClient.ensureQueryData(historyQuery(params.instrumentId)),
  component: InstrumentPage,
});

const compactMoney = (n: number) =>
  n === 0 ? '$0' : Math.abs(n) >= 1000 ? `$${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k` : `$${n.toFixed(n < 10 ? 2 : 0)}`;

function InstrumentPage() {
  const { instrumentId } = Route.useParams();
  const { data } = useSuspenseQuery(historyQuery(instrumentId));
  const { instrument, units, prices, values, trades, mismatches } = data;
  const dates = [...units.map((u) => u.on), ...prices.map((p) => p.on)].sort();
  const domain: [string, string] = [dates[0] ?? todayIso(), dates.at(-1) ?? todayIso()];
  const tradePriced = prices.some((p) => p.priceType === 'trade');

  return (
    <>
      <PageHeader
        title={`${instrument.symbol} · ${instrument.exchange}`}
        description={
          <>
            {instrument.name} ·{' '}
            <Link to="/assets" className="underline">
              All holdings
            </Link>
          </>
        }
      />
      <p className="text-muted mb-4 max-w-3xl text-sm">
        Price, units and value are shown separately: a rising value from buying more units is not a return. Value is plotted only on dates
        with a price{tradePriced ? '; open circles are trade prices, used only where no daily price exists' : ''}.
      </p>
      <CurrentPrice data={data} />
      {mismatches.length > 0 && (
        <Card className="mb-4 p-3">
          {mismatches.map((m) => (
            <p key={`${m.account}${m.on}`} className="text-warning text-sm">
              {m.account} on {shortDate(m.on)}: the statement reports {m.reported} units but transactions add up to {m.computed}.
            </p>
          ))}
        </Card>
      )}
      <div className="grid gap-4">
        <Card className="p-4">
          <TimeSeriesChart
            title={`Unit price (${instrument.currency})`}
            kind="line"
            showDots
            domain={domain}
            formatAxis={(n) => `$${n.toFixed(n < 10 ? 2 : 0)}`}
            points={prices.map((p) => ({
              on: p.on,
              value: Number(p.price),
              label: `${money(p.price, p.currency)} · ${p.priceType === 'trade' ? 'trade price' : p.priceType === 'manual' ? 'entered by hand' : 'daily price'}`,
              hollow: p.priceType === 'trade',
            }))}
          />
        </Card>
        <Card className="p-4">
          <TimeSeriesChart
            title="Units owned"
            kind="step"
            zeroBased
            domain={domain}
            formatAxis={(n) => String(Math.round(n))}
            markers={trades.map((t) => ({ on: t.on, label: t.description }))}
            points={units.map((u) => ({ on: u.on, value: Number(u.quantity), label: `${Number(u.quantity)} units` }))}
          />
          <p className="text-muted mt-1 text-xs">Triangles mark buys.</p>
        </Card>
        <Card className="p-4">
          <TimeSeriesChart
            title={`Holding value (${instrument.currency})`}
            kind="line"
            showDots
            zeroBased
            domain={domain}
            formatAxis={compactMoney}
            points={values.map((v) => ({
              on: v.on,
              value: Number(v.value),
              label: `${money(v.value, v.currency)} = ${Number(v.units)} × ${money(v.price, v.currency)}`,
              hollow: v.priceType === 'trade',
            }))}
          />
        </Card>
      </div>
      <details className="mt-4">
        <summary className="text-muted cursor-pointer text-sm">Table view</summary>
        <Card className="mt-2 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-muted text-left text-xs">
              <tr className="border-line border-b">
                <th className="px-4 py-2 font-medium">Date</th>
                <th className="px-4 py-2 text-right font-medium">Price</th>
                <th className="px-4 py-2 font-medium">Type</th>
                <th className="px-4 py-2 text-right font-medium">Units</th>
                <th className="px-4 py-2 text-right font-medium">Value</th>
              </tr>
            </thead>
            <tbody>
              {values.map((v) => (
                <tr key={v.on} className="border-line border-b last:border-0">
                  <td className="tabular px-4 py-1.5">{shortDate(v.on)}</td>
                  <td className="tabular px-4 py-1.5 text-right">{money(v.price, v.currency)}</td>
                  <td className="text-muted px-4 py-1.5">{v.priceType}</td>
                  <td className="tabular px-4 py-1.5 text-right">{Number(v.units)}</td>
                  <td className="tabular px-4 py-1.5 text-right">{money(v.value, v.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </details>
    </>
  );
}

/** Today's applicable price, with a display-only override for when observations are stale. */
function CurrentPrice({ data }: { data: Awaited<ReturnType<typeof getInstrumentHistory>> }) {
  const queryClient = useQueryClient();
  const save = useServerFn(setOverride);
  const clear = useServerFn(clearOverride);
  const [price, setPrice] = useState('');
  const [error, setError] = useState<string | null>(null);
  const { current, override, instrument } = data;
  const refresh = () => queryClient.invalidateQueries();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await save({ data: { instrumentId: instrument.id, price } });
      setPrice('');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save');
    }
  };

  return (
    <Card className="mb-4 flex flex-wrap items-center gap-3 p-4 text-sm">
      <div className="min-w-48 flex-1">
        <div className="text-muted text-xs">Price today</div>
        {current ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="tabular font-medium">{money(current.price, instrument.currency)}</span>
            <span className="text-muted text-xs">from {shortDate(current.on)}</span>
            {current.stale && <Badge tone="warning">Stale</Badge>}
            {current.tradePriced && <Badge tone="warning">Trade-priced</Badge>}
          </div>
        ) : (
          <span className="text-muted">No price yet</span>
        )}
      </div>
      {override ? (
        <div className="flex items-center gap-2">
          <Badge>Override</Badge>
          <span className="tabular">{money(override.price, instrument.currency)}</span>
          <span className="text-muted text-xs">display only, cleared by a newer price</span>
          <Button variant="ghost" onClick={() => clear({ data: { id: instrument.id } }).then(refresh)}>
            Clear
          </Button>
        </div>
      ) : (
        <form onSubmit={submit} className="flex items-center gap-2">
          <input
            required
            inputMode="decimal"
            placeholder="Override current price"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            className="border-line bg-surface tabular w-44 rounded border px-2 py-1"
            aria-label="Override current price"
          />
          <Button type="submit">Set override</Button>
        </form>
      )}
      {error && <p className="text-negative w-full text-xs">{error}</p>}
    </Card>
  );
}
