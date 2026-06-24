import { createFileRoute } from '@tanstack/react-router'
import { AccountsListPage, accountsListLoader } from '~/features/transactions'

const DEFAULT_PAGE_SIZE = 10

interface AccountsSearch {
  page?: number
  pageSize?: number
}

export const Route = createFileRoute('/accounts/')({
  validateSearch: (search: Record<string, unknown>): AccountsSearch => ({
    page: typeof search.page === 'number' ? search.page : 1,
    pageSize: typeof search.pageSize === 'number' ? search.pageSize : DEFAULT_PAGE_SIZE,
  }),
  loaderDeps: ({ search }) => ({ page: search.page, pageSize: search.pageSize }),
  loader: ({ deps }) => accountsListLoader({ data: { page: deps.page, pageSize: deps.pageSize } }),
  component: () => <AccountsListPage {...Route.useLoaderData()} />,
})
