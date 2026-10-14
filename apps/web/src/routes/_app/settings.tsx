import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { Button, Card, Empty, PageHeader } from '../../components/ui';
import { authClient } from '../../lib/auth-client';
import { shortDate } from '../../lib/format';

export const Route = createFileRoute('/_app/settings')({ component: SettingsPage });

function SettingsPage() {
  const queryClient = useQueryClient();
  const passkeys = useQuery({
    queryKey: ['passkeys'],
    queryFn: async () => {
      const res = await authClient.passkey.listUserPasskeys();
      if (res.error) throw new Error(res.error.message ?? 'Could not load passkeys');
      return res.data;
    },
  });
  const [error, setError] = useState<string | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['passkeys'] });

  const add = async () => {
    setError(null);
    const name = prompt('Name this passkey (e.g. "MacBook Touch ID")') ?? undefined;
    const res = await authClient.passkey.addPasskey({ name });
    if (res?.error) setError(res.error.message ?? 'Could not add passkey');
    await refresh();
  };

  const remove = async (id: string) => {
    if (!confirm('Remove this passkey? You can still sign in with an email code.')) return;
    const res = await authClient.passkey.deletePasskey({ id });
    if (res.error) setError(res.error.message ?? 'Could not remove passkey');
    await refresh();
  };

  return (
    <>
      <PageHeader title="Settings" description="Passkeys are the main way to sign in. Email codes remain available for recovery." />
      <section>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-medium">Passkeys</h2>
          <Button variant="primary" onClick={add}>
            Add a passkey
          </Button>
        </div>
        {error && <p className="text-negative mb-2 text-sm">{error}</p>}
        <Card>
          {passkeys.data?.length === 0 && <Empty>No passkeys yet. Add one to sign in without an email code.</Empty>}
          {passkeys.data?.map((p) => (
            <div key={p.id} className="border-line flex items-center gap-3 border-b px-4 py-3 text-sm last:border-0">
              <span className="flex-1 font-medium">{p.name || 'Unnamed passkey'}</span>
              <span className="text-muted text-xs">
                {p.deviceType === 'multiDevice' ? 'Synced' : 'This device'} · added {shortDate(p.createdAt ? new Date(p.createdAt).toISOString() : null)}
              </span>
              <Button variant="ghost" onClick={() => remove(p.id)}>
                Remove
              </Button>
            </div>
          ))}
        </Card>
      </section>
    </>
  );
}
