import { queryOptions, useQuery, useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { useServerFn } from '@tanstack/react-start';
import { useState } from 'react';
import { z } from 'zod';
import { rangeLabel } from '@finance/shared';
import { categoriesQuery, DashboardHeader, pageRange, periodSearch } from '../../components/dashboard';
import { SankeyChart, type ChartNode } from '../../components/sankey-chart';
import { Button, Card, Empty } from '../../components/ui';
import { money, shortDate } from '../../lib/format';
import { getCashFlow, getNodeLegs } from '../../server/cashflow.functions';

// The same page period as the Overview and Expenses tabs.
const searchSchema = z.object({ ...periodSearch, focus: z.uuid().optional() });
type Search = z.infer<typeof searchSchema>;

const cashFlowQuery = (s: Search) => {
  const { from, to } = pageRange(s);
  return queryOptions({
    queryKey: ['cashflow', from, to, s.tags ?? [], s.focus ?? null],
    queryFn: () => getCashFlow({ data: { from, to, tagIds: s.tags ?? [], focusId: s.focus ?? null } }),
  });
};

export const Route = createFileRoute('/_app/sankey')({
  validateSearch: searchSchema,
  loaderDeps: ({ search }) => search,
  loader: ({ context, deps }) =>
    Promise.all([context.queryClient.ensureQueryData(cashFlowQuery(deps)), context.queryClient.ensureQueryData(categoriesQuery)]),
  component: SankeyPage,
});

function SankeyPage() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const { data } = useSuspenseQuery(cashFlowQuery(search));
  const [selected, setSelected] = useState<ChartNode | null>(null);
  const { from, to } = pageRange(search);

  const set = (patch: Partial<Search>) => {
    setSelected(null);
    void navigate({ search: (prev) => ({ ...prev, ...patch }) });
  };
  const onSelect = (node: ChartNode) => {
    if (node.drillable && node.id !== search.focus) set({ focus: node.id });
    else setSelected(node);
  };

  const t = data.totals;
  return (
    <>
      <DashboardHeader title="Sankey" description={rangeLabel({ from, to })} search={search} set={set} reset={{}} />

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Income" value={t.income} />
        <Stat label="Spending" value={t.spending} hint="Essentials + Lifestyle" />
        <Stat label="Saved" value={t.saved} hint="Savings legs" />
        <Stat label="Net cash flow" value={t.netCashFlow} tone={t.netCashFlow.startsWith('-') ? 'negative' : 'positive'} />
      </div>

      {(t.uncategorisedIncome !== '0' || t.uncategorisedExpense !== '0') && (
        <p className="text-warning mb-4 text-sm">
          {money(t.uncategorisedIncome)} income and {money(t.uncategorisedExpense)} spending are uncategorised.{' '}
          <Link to="/events" search={{ uncategorised: true, page: 0, from, to }} className="underline">
            Categorise them
          </Link>
        </p>
      )}
      {(data.unconvertedLegs > 0 || data.staleConvertedLegs > 0) && (
        <p className="text-warning mb-4 text-sm">
          {data.unconvertedLegs > 0 &&
            `${data.unconvertedLegs} foreign-currency legs have no FX rate on or before their date and are left out. `}
          {data.staleConvertedLegs > 0 && `${data.staleConvertedLegs} were converted with a stale or trade-only rate.`}{' '}
          <Link to="/accounts/assets/prices" className="underline">
            Add FX rates
          </Link>
        </p>
      )}
      <Card className="p-4">
        {data.focus && (
          <div className="mb-2 flex items-center gap-2 text-sm">
            <button className="text-accent underline" onClick={() => set({ focus: undefined })}>
              All categories
            </button>
            <span className="text-muted">› {data.focus.path.join(' › ')}</span>
          </div>
        )}
        {data.links.length === 0 ? (
          <Empty>No cash flow in this period{search.tags?.length ? ' for the selected tags' : ''}.</Empty>
        ) : (
          <SankeyChart nodes={data.nodes} links={data.links} onSelect={onSelect} />
        )}
        {data.negative.length > 0 && (
          <p className="text-muted mt-2 text-xs">
            Not drawn (refunds exceed spending): {data.negative.map((n) => `${n.label} ${money(n.value)}`).join(', ')}
          </p>
        )}
      </Card>

      {selected && <NodeLegs node={selected} from={from} to={to} tags={search.tags ?? []} onClose={() => setSelected(null)} />}

      <details className="mt-4">
        <summary className="text-muted cursor-pointer text-sm">Table view</summary>
        <Card className="mt-2 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-muted text-left text-xs">
              <tr className="border-line border-b">
                <th className="px-4 py-2 font-medium">From</th>
                <th className="px-4 py-2 font-medium">To</th>
                <th className="px-4 py-2 text-right font-medium">Amount</th>
              </tr>
            </thead>
            <tbody>
              {data.links.map((l) => {
                const label = (id: string) => data.nodes.find((n) => n.id === id)?.label ?? id;
                return (
                  <tr key={`${l.source}-${l.target}`} className="border-line border-b last:border-0">
                    <td className="px-4 py-1.5">{label(l.source)}</td>
                    <td className="px-4 py-1.5">{label(l.target)}</td>
                    <td className="tabular px-4 py-1.5 text-right">{money(l.value)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      </details>
    </>
  );
}

function Stat({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: 'positive' | 'negative' }) {
  return (
    <Card className="p-3">
      <div className="text-muted text-xs">{label}</div>
      <div className={`tabular text-lg font-semibold ${tone === 'negative' ? 'text-negative' : ''}`}>{money(value)}</div>
      {hint && <div className="text-muted text-xs">{hint}</div>}
    </Card>
  );
}

function NodeLegs({ node, from, to, tags, onClose }: { node: ChartNode; from: string; to: string; tags: string[]; onClose: () => void }) {
  const fetchLegs = useServerFn(getNodeLegs);
  const legs = useQuery({
    queryKey: ['node-legs', node.id, from, to, tags],
    queryFn: () => fetchLegs({ data: { from, to, tagIds: tags, node: node.id } }),
  });
  return (
    <Card className="mt-4">
      <div className="border-line flex items-center justify-between border-b px-4 py-2">
        <h2 className="text-sm font-medium">
          {node.label} · {money(node.value)}
        </h2>
        <Button variant="ghost" onClick={onClose}>
          Close
        </Button>
      </div>
      {legs.data?.length === 0 && <Empty>No legs.</Empty>}
      {legs.data?.map((l) => (
        <div key={l.id} className="border-line flex flex-wrap gap-3 border-b px-4 py-2 text-sm last:border-0">
          <span className="text-muted tabular w-24">{shortDate(l.occurredOn)}</span>
          <Link to="/events" search={{ id: l.eventId, uncategorised: false, page: 0 }} className="flex-1 hover:underline">
            {l.description}
          </Link>
          <span className="text-muted">{l.accountName}</span>
          <span className="tabular w-28 text-right">{money(l.amount, l.commodity)}</span>
        </div>
      ))}
    </Card>
  );
}
