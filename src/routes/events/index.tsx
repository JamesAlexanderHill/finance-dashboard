import { createFileRoute } from '@tanstack/react-router'
import { EventsPage, eventsLoader } from '~/features/transactions'

const DEFAULT_PAGE_SIZE = 10

interface EventsSearch {
  accountId?: string
  page?: number
  pageSize?: number
}

export const Route = createFileRoute('/events/')({
  validateSearch: (search: Record<string, unknown>): EventsSearch => ({
    accountId: typeof search.accountId === 'string' ? search.accountId : undefined,
    page: typeof search.page === 'number' ? search.page : 1,
    pageSize: typeof search.pageSize === 'number' ? search.pageSize : DEFAULT_PAGE_SIZE,
  }),
  loaderDeps: ({ search }) => ({ page: search.page, pageSize: search.pageSize, accountId: search.accountId }),
  loader: ({ deps }) =>
    eventsLoader({ data: { accountId: deps.accountId, page: deps.page, pageSize: deps.pageSize } }),
  component: () => <EventsPage {...Route.useLoaderData()} />,
})
