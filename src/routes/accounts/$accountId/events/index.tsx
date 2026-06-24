import { createFileRoute } from '@tanstack/react-router'
import { AccountEventsPage, accountEventsLoader } from '~/features/transactions'

const DEFAULT_PAGE_SIZE = 10

interface EventsSearch {
  page?: number
  pageSize?: number
}

export const Route = createFileRoute('/accounts/$accountId/events/')({
  validateSearch: (search: Record<string, unknown>): EventsSearch => ({
    page: typeof search.page === 'number' ? search.page : 1,
    pageSize: typeof search.pageSize === 'number' ? search.pageSize : DEFAULT_PAGE_SIZE,
  }),
  loaderDeps: ({ search }) => ({ page: search.page, pageSize: search.pageSize }),
  loader: ({ params, deps }) =>
    accountEventsLoader({ data: { accountId: params.accountId, page: deps.page, pageSize: deps.pageSize } }),
  component: () => <AccountEventsPage {...Route.useLoaderData()} />,
})
