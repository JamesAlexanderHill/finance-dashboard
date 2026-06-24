/// <reference types="vite/client" />
import {
  Outlet,
  createRootRouteWithContext,
  redirect,
  useNavigate,
  useSearch,
} from '@tanstack/react-router'
import appCss from '~/styles/app.css?url'
import { TanStackRouterDevtools } from '@tanstack/react-router-devtools'
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'
import * as React from 'react'
import type { QueryClient } from '@tanstack/react-query'
import { fetchAuthUser } from '~/lib/auth-guard'
import { RootDocument } from '~/features/core/app-shell'
import { EventDrawer } from '~/features/transactions/components/event/event-drawer'

// Bootstrap: registers all feature plugins (nav links, providers, etc.)
import '~/features'

type RootSearch = {
  viewEvent?: string
}

export const Route = createRootRouteWithContext<{
  queryClient: QueryClient
}>()({
  validateSearch: (search: Record<string, unknown>): RootSearch => ({
    viewEvent: typeof search.viewEvent === 'string' ? search.viewEvent : undefined,
  }),
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
      {import.meta.env.DEV && (
        <>
          <TanStackRouterDevtools position="bottom-right" />
          <ReactQueryDevtools buttonPosition="bottom-left" />
        </>
      )}
    </RootDocument>
  )
}
