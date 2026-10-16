import { queryOptions, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useServerFn } from '@tanstack/react-start';
import { useState } from 'react';
import { Button, Card, Empty, PageHeader } from '../../components/ui';
import { money, shortDate } from '../../lib/format';
import { getTransferReview, linkTransactions, setTransferMark, type TransferTxView } from '../../server/transfers.functions';

const reviewQuery = queryOptions({ queryKey: ['transfer-review'], queryFn: () => getTransferReview() });

export const Route = createFileRoute('/_app/events/transfers')({
  loader: ({ context }) => context.queryClient.ensureQueryData(reviewQuery),
  component: TransfersPage,
});

function TransfersPage() {
  const { data } = useSuspenseQuery(reviewQuery);
  return (
    <>
      <PageHeader
        title="Transfers"
        description="Transfers between your accounts are linked automatically when exactly one opposite, equal amount appears in another account within 5 days. Everything else waits here for you."
      />

      <section className="mb-8">
        <h2 className="mb-1 text-sm font-medium">Unmatched transfers</h2>
        <p className="text-muted mb-2 text-xs">
          Money moved to or from one of your accounts whose other side hasn&apos;t been imported. These stay out of income and spending.
        </p>
        <Card>
          {data.unmatched.length === 0 && <Empty>No unmatched transfers.</Empty>}
          {data.unmatched.map((item) => (
            <ReviewItem key={item.transaction.id} item={item} unmatched />
          ))}
        </Card>
      </section>

      <section>
        <h2 className="mb-1 text-sm font-medium">Possible transfers</h2>
        <p className="text-muted mb-2 text-xs">
          More than one transaction could be the other side, so nothing was linked automatically. Link the right one, or leave them as they
          are.
        </p>
        <Card>
          {data.ambiguous.length === 0 && <Empty>Nothing to review.</Empty>}
          {data.ambiguous.map((item) => (
            <ReviewItem key={item.transaction.id} item={item} />
          ))}
        </Card>
      </section>
    </>
  );
}

function TxLine({ tx }: { tx: TransferTxView }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 text-sm">
      <span className="text-muted tabular w-24">{shortDate(tx.postedOn)}</span>
      <span className="text-muted min-w-32">{tx.accountName}</span>
      <Link
        to="/accounts/transactions"
        search={{ id: tx.id, status: 'all', uncategorised: false, page: 0 }}
        className="flex-1 hover:underline"
      >
        {tx.description}
      </Link>
      <span className="tabular w-28 text-right">{money(tx.amount, tx.commodity)}</span>
    </div>
  );
}

function ReviewItem({
  item,
  unmatched = false,
}: {
  item: { transaction: TransferTxView; candidates: TransferTxView[] };
  unmatched?: boolean;
}) {
  const queryClient = useQueryClient();
  const link = useServerFn(linkTransactions);
  const mark = useServerFn(setTransferMark);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await queryClient.invalidateQueries();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="border-line border-b px-4 py-3 last:border-0">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <TxLine tx={item.transaction} />
        </div>
        {unmatched && (
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => act(() => mark({ data: { transactionId: item.transaction.id, isTransfer: false } }))}
          >
            Not a transfer
          </Button>
        )}
      </div>
      {item.candidates.length > 0 && (
        <div className="mt-2 space-y-1 border-l-2 pl-3" style={{ borderColor: 'var(--border)' }}>
          <div className="text-muted text-xs">{item.candidates.length === 1 ? 'Possible other side' : 'Possible other sides'}</div>
          {item.candidates.map((c) => (
            <div key={c.id} className="flex flex-wrap items-center gap-3">
              <div className="min-w-0 flex-1">
                <TxLine tx={c} />
              </div>
              <Button disabled={busy} onClick={() => act(() => link({ data: { transactionIds: [item.transaction.id, c.id] } }))}>
                Link
              </Button>
            </div>
          ))}
        </div>
      )}
      {error && <p className="text-negative mt-1 text-xs">{error}</p>}
    </div>
  );
}
