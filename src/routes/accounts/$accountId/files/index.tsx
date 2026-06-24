import { createFileRoute } from '@tanstack/react-router'
import { AccountFilesPage, accountFilesLoader } from '~/features/transactions'

const DEFAULT_PAGE_SIZE = 10

interface FilesSearch {
  page?: number
  pageSize?: number
}

export const Route = createFileRoute('/accounts/$accountId/files/')({
  validateSearch: (search: Record<string, unknown>): FilesSearch => ({
    page: typeof search.page === 'number' ? search.page : 1,
    pageSize: typeof search.pageSize === 'number' ? search.pageSize : DEFAULT_PAGE_SIZE,
  }),
  loaderDeps: ({ search }) => ({ page: search.page, pageSize: search.pageSize }),
  loader: ({ params, deps }) =>
    accountFilesLoader({ data: { accountId: params.accountId, page: deps.page, pageSize: deps.pageSize } }),
  component: () => <AccountFilesPage {...Route.useLoaderData()} />,
})
