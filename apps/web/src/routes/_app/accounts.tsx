import { queryOptions, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useServerFn } from '@tanstack/react-start';
import { useState } from 'react';
import { Badge, Button, Card, Empty, PageHeader } from '../../components/ui';
import { money, shortDate } from '../../lib/format';
import { listAccounts, updateAccount } from '../../server/accounts.functions';

const accountsQuery = queryOptions({ queryKey: ['accounts'], queryFn: () => listAccounts() });

export const Route = createFileRoute('/_app/accounts')({
  loader: ({ context }) => context.queryClient.ensureQueryData(accountsQuery),
  component: AccountsPage,
});

type Account = Awaited<ReturnType<typeof listAccounts>>[number];

function AccountsPage() {
  const accounts = useSuspenseQuery(accountsQuery);
  const groups = Map.groupBy(accounts.data, (a) => a.institution);

  return (
    <>
      <PageHeader
        title="Accounts"
        description="Accounts are created automatically from statements. New ones start unconfirmed until you check them."
      />
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
                <AccountRow key={a.id} account={a} />
              ))}
            </Card>
          </section>
        ))}
      </div>
    </>
  );
}

function AccountRow({ account: a }: { account: Account }) {
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
          <button className="font-medium hover:underline" onClick={() => setEditing(true)} title="Rename">
            {a.name}
          </button>
        )}
        <div className="text-muted text-xs">
          {a.maskedIdentifier} · {a.accountType.replace('_', ' ')} · {a.classification} · {a.activeTransactions} transactions
        </div>
      </div>
      {a.status === 'unconfirmed' && (
        <div className="flex items-center gap-2">
          <Badge tone="warning">Unconfirmed</Badge>
          <Button onClick={() => save({ confirm: true })}>Confirm</Button>
        </div>
      )}
      <div className="tabular text-right">
        <div className={a.balance && a.balance.balance.startsWith('-') ? 'text-negative' : ''}>
          {money(a.balance?.balance, a.commodity)}
        </div>
        <div className="text-muted text-xs">{a.balance ? `as of ${shortDate(a.balance.on)}` : 'Balance unknown'}</div>
      </div>
    </div>
  );
}
