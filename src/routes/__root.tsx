/// <reference types="vite/client" />
import {
  HeadContent,
  Link,
  Outlet,
  Scripts,
  createRootRouteWithContext,
  useNavigate,
  useRouter,
  useSearch,
} from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createServerFn } from '@tanstack/react-start'
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'
import { TanStackRouterDevtools } from '@tanstack/react-router-devtools'
import * as React from 'react'
import type { QueryClient } from '@tanstack/react-query'
import { db } from '~/db'
import { users } from '~/db/schema'
import { workspaceService, getSession, setCurrentUserId, setCurrentWorkspaceId } from '~/db/services'
import { DefaultCatchBoundary } from '~/components/DefaultCatchBoundary'
import { NotFound } from '~/components/NotFound'
import { EventDrawer } from '~/components/event/event-drawer'
import { Select, SelectTrigger, SelectValue, SelectPopup, SelectItem } from '~/components/ui/select'
import appCss from '~/styles/app.css?url'

// ─── Server functions ─────────────────────────────────────────────────────────

const getSidebarData = createServerFn({ method: 'GET' }).handler(async () => {
  const session = await getSession()
  if (!session) return null

  const [allUsers, workspaces] = await Promise.all([
    db.select({ id: users.id, name: users.name, email: users.email }).from(users).orderBy(users.name),
    workspaceService.list(session.ctx),
  ])

  return {
    user: { id: session.user.id, name: session.user.name, email: session.user.email },
    workspace: { id: session.workspace.id, name: session.workspace.name, isPersonal: session.workspace.isPersonal },
    users: allUsers,
    workspaces,
  }
})

const switchUser = createServerFn({ method: 'POST' })
  .inputValidator((data: unknown) => data as { userId: string })
  .handler(async ({ data }) => {
    setCurrentUserId(data.userId)
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
  { to: '/workspaces', label: 'Workspaces', exact: false },
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

  async function handleUserChange(userId: string) {
    if (userId === data?.user.id) return
    await switchUser({ data: { userId } })
    await refresh()
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
                  {w.isPersonal ? ' (Personal)' : ''}
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

      {/* User switcher */}
      {data && (
        <div className="px-2 py-2 border-t border-gray-200 dark:border-gray-800">
          <Select
            items={data.users.map((u) => ({ value: u.id, label: u.name }))}
            value={data.user.id}
            onValueChange={(value) => handleUserChange(value as string)}
          >
            <SelectTrigger className="w-full justify-between">
              <SelectValue />
            </SelectTrigger>
            <SelectPopup>
              {data.users.map((u) => (
                <SelectItem key={u.id} value={u.id}>
                  {u.name}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        </div>
      )}
    </aside>
  )
}

// ─── Root document ────────────────────────────────────────────────────────────

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body className="bg-gray-50 dark:bg-gray-950">
        <Sidebar />
        <main className="ml-56 min-h-screen p-6">{children}</main>
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
