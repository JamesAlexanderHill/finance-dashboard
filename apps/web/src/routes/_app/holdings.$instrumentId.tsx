import { queryOptions, useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { todayIso } from '@finance/shared';
import { TimeSeriesChart } from '../../components/time-series-chart';
import { Card, PageHeader } from '../../components/ui';
import { money, shortDate } from '../../lib/format';
import { getInstrumentHistory } from '../../server/holdings.functions';

const historyQuery = (id: string) =>
  queryOptions({ queryKey: ['instrument-history', id], queryFn: () => getInstrumentHistory({ data: { id } }) });

export const Route = createFileRoute('/_app/holdings/$instrumentId')({
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
            <Link to="/holdings" className="underline">
              All holdings
            </Link>
          </>
        }
      />
      <p className="text-muted mb-4 max-w-3xl text-sm">
        Price, units and value are shown separately: a rising value from buying more units is not a return. Value is plotted only on dates
        with a price{tradePriced ? '; open circles are trade prices, used only where no daily price exists' : ''}.
      </p>
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
