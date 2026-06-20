/// <reference types="vite/client" />
import {
  HeadContent,
  Link,
  Outlet,
  Scripts,
  createRootRouteWithContext,
  redirect,
  useNavigate,
  useRouter,
  useRouterState,
  useSearch,
} from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createServerFn } from '@tanstack/react-start'
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'
import { TanStackRouterDevtools } from '@tanstack/react-router-devtools'
import { LogOut, Settings, ChevronsUpDown, Building2 } from 'lucide-react'
import * as React from 'react'
import type { QueryClient } from '@tanstack/react-query'
import { workspaceService, getSession, setCurrentWorkspaceId } from '~/db/services'
import { fetchAuthUser } from '~/lib/auth-guard'
import { authClient } from '~/lib/auth-client'
import { DefaultCatchBoundary } from '~/components/DefaultCatchBoundary'
import { NotFound } from '~/components/NotFound'
import { EventDrawer } from '~/components/event/event-drawer'
import { Select, SelectTrigger, SelectValue, SelectPopup, SelectItem } from '~/components/ui/select'
import { Menu, MenuTrigger, MenuPopup, MenuItem, MenuSeparator } from '~/components/ui/menu'
import appCss from '~/styles/app.css?url'

// ─── Server functions ─────────────────────────────────────────────────────────

const getSidebarData = createServerFn({ method: 'GET' }).handler(async () => {
  const session = await getSession()
  if (!session) return null

  const workspaces = await workspaceService.list(session.ctx)

  return {
    user: { id: session.user.id, name: session.user.name, email: session.user.email },
    workspace: { id: session.workspace.id, name: session.workspace.name },
    workspaces,
  }
})

const switchWorkspace = createServerFn({ method: 'POST' })
  .inputValidator((data: unknown) => data as { workspaceId: string })
  .handler(async ({ data }) => {
    setCurrentWorkspaceId(data.workspaceId)
  })

type RootSearch = {
  viewEvent?: string
}

export const Route = createRootRouteWithContext<{
  queryClient: QueryClient
}>()({
  validateSearch: (search: Record<string, unknown>): RootSearch => ({
    viewEvent: typeof search.viewEvent === 'string' ? search.viewEvent : undefined,
  }),
  // Gate the whole app behind authentication. Unauthenticated visitors are
  // redirected to /login (which is itself excluded from the check).
  beforeLoad: async ({ location }) => {
    if (location.pathname === '/login') return
    const user = await fetchAuthUser()
    if (!user) throw redirect({ to: '/login' })
    return { user }
  },
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'Finance Dashboard' },
    ],
    links: [
      { rel: 'stylesheet', href: appCss },
      { rel: 'icon', href: '/favicon.ico' },
    ],
  }),
  errorComponent: (props) => (
    <RootDocument>
      <DefaultCatchBoundary {...props} />
    </RootDocument>
  ),
  notFoundComponent: () => <NotFound />,
  component: RootComponent,
})

function RootComponent() {
  const { viewEvent } = useSearch({ from: '__root__' })
  const navigate = useNavigate()

  function handleCloseDrawer() {
    navigate({ search: (prev) => ({ ...prev, viewEvent: undefined }) })
  }

  return (
    <RootDocument>
      <Outlet />
      <EventDrawer eventId={viewEvent} onClose={handleCloseDrawer} />
    </RootDocument>
  )
}

// ─── Sidebar ──────────────────────────────────────────────────────────────────

const NAV_LINKS = [
  { to: '/', label: 'Dashboard', exact: true },
  { to: '/accounts', label: 'Accounts', exact: false },
  { to: '/events', label: 'Events', exact: false },
  { to: '/categories', label: 'Categories', exact: false },
  { to: '/sankey', label: 'Cash Flow', exact: false },
] as const

const DEV_LINK = { to: '/dev', label: 'Dev Tools', exact: false } as const

function Sidebar() {
  const isDev = import.meta.env.DEV
  const links = isDev ? [...NAV_LINKS, DEV_LINK] : NAV_LINKS
  const router = useRouter()
  const queryClient = useQueryClient()

  const { data } = useQuery({ queryKey: ['sidebar'], queryFn: () => getSidebarData() })

  async function refresh() {
    await queryClient.invalidateQueries()
    await router.invalidate()
  }

  async function handleWorkspaceChange(workspaceId: string) {
    if (workspaceId === data?.workspace.id) return
    await switchWorkspace({ data: { workspaceId } })
    await refresh()
  }

  return (
    <aside className="fixed inset-y-0 left-0 w-56 flex flex-col bg-white dark:bg-gray-900 border-r border-gray-200 dark:border-gray-800 z-10">
      {/* Logo */}
      <div className="flex items-center gap-2 px-4 h-14 border-b border-gray-200 dark:border-gray-800">
        <span className="text-base font-semibold text-gray-900 dark:text-gray-100">
          Finance
        </span>
      </div>

      {/* Workspace switcher */}
      {data && (
        <div className="px-2 py-2 border-b border-gray-200 dark:border-gray-800">
          <Select
            items={data.workspaces.map((w) => ({ value: w.id, label: w.name }))}
            value={data.workspace.id}
            onValueChange={(value) => handleWorkspaceChange(value as string)}
          >
            <SelectTrigger className="w-full justify-between">
              <SelectValue />
            </SelectTrigger>
            <SelectPopup>
              {data.workspaces.map((w) => (
                <SelectItem key={w.id} value={w.id}>
                  {w.name}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        </div>
      )}

      {/* Nav links */}
      <nav className="flex-1 overflow-y-auto py-4 px-2 space-y-1">
        {links.map((link) => (
          <Link
            key={link.to}
            to={link.to}
            activeOptions={{ exact: link.exact }}
            className="flex items-center gap-2 px-3 py-2 rounded-md text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            activeProps={{
              className:
                'flex items-center gap-2 px-3 py-2 rounded-md text-sm text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950 font-medium',
            }}
          >
            {link.label}
          </Link>
        ))}
      </nav>

      {/* User quick actions */}
      {data && <UserMenu name={data.user.name} email={data.user.email} />}
    </aside>
  )
}

// ─── User menu ──────────────────────────────────────────────────────────────

function UserMenu({ name, email }: { name: string; email: string }) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const initials = name.trim().slice(0, 2).toUpperCase() || '?'

  async function handleLogout() {
    await authClient.signOut()
    queryClient.clear()
    router.navigate({ to: '/login' })
  }

  return (
    <div className="px-2 py-2 border-t border-gray-200 dark:border-gray-800">
      <Menu>
        <MenuTrigger className="w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors outline-none">
          <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-blue-100 dark:bg-blue-950 text-xs font-medium text-blue-700 dark:text-blue-300">
            {initials}
          </span>
          <span className="flex-1 min-w-0">
            <span className="block truncate text-sm font-medium text-gray-900 dark:text-gray-100">{name}</span>
            <span className="block truncate text-xs text-gray-500 dark:text-gray-400">{email}</span>
          </span>
          <ChevronsUpDown className="size-4 shrink-0 text-gray-400" />
        </MenuTrigger>
        <MenuPopup className="w-52">
          <MenuItem onClick={() => router.navigate({ to: '/settings' })}>
            <Settings className="size-4" />
            Account settings
          </MenuItem>
          <MenuItem onClick={() => router.navigate({ to: '/workspaces' })}>
            <Building2 className="size-4" />
            Workspaces
          </MenuItem>
          <MenuSeparator />
          <MenuItem
            onClick={handleLogout}
            className="text-red-600 dark:text-red-400 data-highlighted:bg-red-50 dark:data-highlighted:bg-red-950/40"
          >
            <LogOut className="size-4" />
            Logout
          </MenuItem>
        </MenuPopup>
      </Menu>
    </div>
  )
}

// ─── Root document ────────────────────────────────────────────────────────────

function RootDocument({ children }: { children: React.ReactNode }) {
  // The login page renders standalone, without the app sidebar/chrome.
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const showChrome = pathname !== '/login'

  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body className="bg-gray-50 dark:bg-gray-950">
        {showChrome && <Sidebar />}
        <main className={showChrome ? 'ml-56 min-h-screen p-6' : 'min-h-screen'}>{children}</main>
        {import.meta.env.DEV && (
          <>
            <TanStackRouterDevtools position="bottom-right" />
            <ReactQueryDevtools buttonPosition="bottom-left" />
          </>
        )}
        <Scripts />
      </body>
    </html>
  )
}
