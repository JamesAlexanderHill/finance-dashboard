import { createFileRoute } from '@tanstack/react-router'
import { AccountInstrumentsPage, accountInstrumentsLoader } from '~/features/transactions'

const DEFAULT_PAGE_SIZE = 10

interface InstrumentsSearch {
  page?: number
  pageSize?: number
}

export const Route = createFileRoute('/accounts/$accountId/instruments/')({
  validateSearch: (search: Record<string, unknown>): InstrumentsSearch => ({
    page: typeof search.page === 'number' ? search.page : 1,
    pageSize: typeof search.pageSize === 'number' ? search.pageSize : DEFAULT_PAGE_SIZE,
  }),
  loaderDeps: ({ search }) => ({ page: search.page, pageSize: search.pageSize }),
  loader: ({ params, deps }) =>
    accountInstrumentsLoader({ data: { accountId: params.accountId, page: deps.page, pageSize: deps.pageSize } }),
  component: () => <AccountInstrumentsPage {...Route.useLoaderData()} />,
})
