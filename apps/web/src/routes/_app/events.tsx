import { queryOptions, useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { z } from 'zod';
import { Badge, Button, Card, Empty, PageHeader } from '../../components/ui';
import { money, shortDate } from '../../lib/format';
import { listAccounts } from '../../server/accounts.functions';
import { listEvents } from '../../server/events.functions';

const PAGE = 100;
const TYPES = ['income', 'expense', 'refund', 'internal_transfer', 'opening_balance'] as const;

const searchSchema = z.object({
  accountId: z.uuid().optional(),
  type: z.enum(TYPES).optional(),
  page: z.number().int().min(0).default(0),
});
type Search = z.infer<typeof searchSchema>;

const eventsQuery = (s: Search) =>
  queryOptions({
    queryKey: ['events', s],
    queryFn: () => listEvents({ data: { accountId: s.accountId, type: s.type, limit: PAGE, offset: s.page * PAGE } }),
  });
const accountsQuery = queryOptions({ queryKey: ['accounts'], queryFn: () => listAccounts() });

export const Route = createFileRoute('/_app/events')({
  validateSearch: searchSchema,
  loaderDeps: ({ search }) => search,
  loader: ({ context, deps }) =>
    Promise.all([context.queryClient.ensureQueryData(eventsQuery(deps)), context.queryClient.ensureQueryData(accountsQuery)]),
  component: EventsPage,
});

function EventsPage() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const { data } = useSuspenseQuery(eventsQuery(search));
  const { data: accounts } = useSuspenseQuery(accountsQuery);
  const set = (patch: Partial<Search>) => navigate({ search: (prev) => ({ ...prev, page: 0, ...patch }) });

  return (
    <>
      <PageHeader
        title="Events"
        description="Economic events rebuilt from active transactions and your decisions. Each leg moves one of your accounts."
      />
      <div className="mb-4 flex flex-wrap gap-2 text-sm">
        <select value={search.accountId ?? ''} onChange={(e) => set({ accountId: e.target.value || undefined })} className="border-line bg-surface rounded border px-2 py-1.5">
          <option value="">All accounts</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.institution} · {a.name}
            </option>
          ))}
        </select>
        <select value={search.type ?? ''} onChange={(e) => set({ type: (e.target.value || undefined) as Search['type'] })} className="border-line bg-surface rounded border px-2 py-1.5">
          <option value="">All types</option>
          {TYPES.map((t) => (
            <option key={t} value={t}>
              {t.replace('_', ' ')}
            </option>
          ))}
        </select>
      </div>
      <Card>
        {data.rows.length === 0 && <Empty>No events.</Empty>}
        {data.rows.map((e) => (
          <div key={e.id} className="border-line border-b px-4 py-3 last:border-0">
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-muted tabular w-24 text-sm">{shortDate(e.occurredOn)}</span>
              <span className="flex-1 text-sm font-medium">{e.description}</span>
              <Badge tone={e.type === 'income' ? 'positive' : e.type === 'opening_balance' ? 'neutral' : 'warning'}>{e.type.replace('_', ' ')}</Badge>
              {e.status !== 'ok' && <Badge tone="negative">{e.status.replace('_', ' ')}</Badge>}
            </div>
            <ul className="mt-1 pl-28 text-xs">
              {e.legs.map((l) => (
                <li key={l.id} className="text-muted flex flex-wrap gap-3">
                  <span className="min-w-32">{l.accountName}</span>
                  <span>{l.role.replace('_', ' ')}</span>
                  <span className="tabular text-ink">{money(l.amount, l.commodity)}</span>
                  <span>{l.category ?? (e.type === 'opening_balance' ? '' : 'Uncategorised')}</span>
                  {l.transactionId && (
                    <Link to="/transactions" search={{ id: l.transactionId, status: 'all', uncategorised: false, page: 0 }} className="hover:underline">
                      transaction
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          </div>
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
