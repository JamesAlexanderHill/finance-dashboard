import { createFileRoute } from '@tanstack/react-router'
import { FileDetailPage, fileDetailLoader } from '~/features/transactions'

const DEFAULT_PAGE_SIZE = 10

interface ImportSearch {
  page?: number
  pageSize?: number
}

export const Route = createFileRoute('/accounts/$accountId/files/$fileId')({
  validateSearch: (search: Record<string, unknown>): ImportSearch => ({
    page: typeof search.page === 'number' ? search.page : 1,
    pageSize: typeof search.pageSize === 'number' ? search.pageSize : DEFAULT_PAGE_SIZE,
  }),
  loaderDeps: ({ search }) => ({ page: search.page, pageSize: search.pageSize }),
  loader: ({ params, deps }) =>
    fileDetailLoader({ data: { accountId: params.accountId, fileId: params.fileId, page: deps.page, pageSize: deps.pageSize } }),
  component: () => <FileDetailPage {...Route.useLoaderData()} />,
})
