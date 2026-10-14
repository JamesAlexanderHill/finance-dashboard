import { createFileRoute, Link, Outlet, redirect, useRouter } from '@tanstack/react-router';
import { authClient } from '../lib/auth-client';
import { getViewer } from '../server/session.functions';

export const Route = createFileRoute('/_app')({
  // A UX guard only; every server function and route re-checks the session itself.
  beforeLoad: async () => {
    const viewer = await getViewer();
    if (!viewer) throw redirect({ to: '/login' });
    return { viewer };
  },
  component: AppLayout,
});

const NAV = [
  { to: '/', label: 'Cash flow' },
  { to: '/transactions', label: 'Transactions' },
  { to: '/events', label: 'Events' },
  { to: '/transfers', label: 'Transfers' },
  { to: '/holdings', label: 'Holdings' },
  { to: '/prices', label: 'Prices' },
  { to: '/statements', label: 'Statements' },
  { to: '/accounts', label: 'Accounts' },
  { to: '/categories', label: 'Categories' },
  { to: '/settings', label: 'Settings' },
] as const;

function AppLayout() {
  const router = useRouter();
  const { viewer } = Route.useRouteContext();
  const signOut = async () => {
    await authClient.signOut();
    await router.invalidate();
    await router.navigate({ to: '/login' });
  };

  return (
    <div className="min-h-screen">
      <header className="border-line bg-surface border-b">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <span className="font-semibold">Finance</span>
          <nav className="flex flex-wrap gap-1 text-sm">
            {NAV.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                activeOptions={{ exact: item.to === '/' }}
                className="text-muted hover:text-ink rounded px-2 py-1"
                activeProps={{ className: 'bg-surface-2 text-ink! font-medium' }}
              >
                {item.label}
              </Link>
            ))}
          </nav>
          <div className="text-muted ml-auto flex items-center gap-3 text-sm">
            <span className="hidden sm:inline">{viewer.email}</span>
            <button onClick={signOut} className="hover:text-ink underline">
              Sign out
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
