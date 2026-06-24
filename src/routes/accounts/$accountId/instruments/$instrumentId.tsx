import { createFileRoute } from '@tanstack/react-router'
import { InstrumentDetailPage, instrumentDetailLoader } from '~/features/transactions'

const DEFAULT_PAGE_SIZE = 10

interface InstrumentSearch {
  page?: number
  pageSize?: number
}

export const Route = createFileRoute('/accounts/$accountId/instruments/$instrumentId')({
  validateSearch: (search: Record<string, unknown>): InstrumentSearch => ({
    page: typeof search.page === 'number' ? search.page : 1,
    pageSize: typeof search.pageSize === 'number' ? search.pageSize : DEFAULT_PAGE_SIZE,
  }),
  loaderDeps: ({ search }) => ({ page: search.page, pageSize: search.pageSize }),
  loader: ({ params, deps }) =>
    instrumentDetailLoader({ data: { accountId: params.accountId, instrumentId: params.instrumentId, page: deps.page, pageSize: deps.pageSize } }),
  component: () => <InstrumentDetailPage {...Route.useLoaderData()} />,
})
