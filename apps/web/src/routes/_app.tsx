import { createFileRoute, Link, Outlet, redirect, useRouter, useRouterState } from '@tanstack/react-router';
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

/**
 * The six sections and their tabs. A tab is active on its own path and the paths under it, unless a
 * longer tab matches; a section is active when one of its tabs is.
 */
const SECTIONS = [
  {
    label: 'Dashboard',
    tabs: [
      { to: '/', label: 'Overview' },
      { to: '/cash-flow', label: 'Cash flow' },
    ],
  },
  {
    label: 'Events',
    tabs: [
      { to: '/events', label: 'Events' },
      { to: '/transfers', label: 'Transfers' },
    ],
  },
  {
    label: 'Accounts',
    tabs: [
      { to: '/accounts', label: 'Accounts' },
      { to: '/transactions', label: 'Transactions' },
      { to: '/statements', label: 'Statements' },
    ],
  },
  { label: 'Categories', tabs: [{ to: '/categories', label: 'Categories' }] },
  {
    label: 'Assets',
    tabs: [
      { to: '/holdings', label: 'Holdings' },
      { to: '/prices', label: 'Prices' },
    ],
  },
  { label: 'Settings', tabs: [{ to: '/settings', label: 'Settings' }] },
] as const;

type Tab = (typeof SECTIONS)[number]['tabs'][number];

function activeTab(pathname: string): Tab | undefined {
  const matches = (to: string) => pathname === to || (to !== '/' && pathname.startsWith(`${to}/`));
  return SECTIONS.flatMap((s) => s.tabs as readonly Tab[])
    .filter((t) => matches(t.to))
    .sort((a, b) => b.to.length - a.to.length)[0];
}

function AppLayout() {
  const router = useRouter();
  const { viewer } = Route.useRouteContext();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const tab = activeTab(pathname);
  const section = SECTIONS.find((s) => (s.tabs as readonly Tab[]).includes(tab!));
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
            {SECTIONS.map((s) => (
              <Link
                key={s.label}
                to={s.tabs[0].to}
                className={`rounded px-2 py-1 ${s === section ? 'bg-surface-2 text-ink font-medium' : 'text-muted hover:text-ink'}`}
              >
                {s.label}
              </Link>
            ))}
          </nav>
          <div className="text-muted ml-auto flex items-center gap-3 text-sm">
            <span className="hidden 2xl:inline">{viewer.email}</span>
            <button onClick={signOut} className="hover:text-ink underline">
              Sign out
            </button>
          </div>
        </div>
        {section && section.tabs.length > 1 && (
          <nav className="mx-auto flex max-w-6xl gap-4 overflow-x-auto px-4 text-sm">
            {section.tabs.map((t) => (
              <Link
                key={t.to}
                to={t.to}
                className={`-mb-px border-b-2 py-2 whitespace-nowrap ${
                  t === tab ? 'border-accent text-ink font-medium' : 'text-muted hover:text-ink border-transparent'
                }`}
              >
                {t.label}
              </Link>
            ))}
          </nav>
        )}
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
