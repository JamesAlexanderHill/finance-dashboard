import { createFileRoute } from '@tanstack/react-router'
import { AccountDetailPage, accountDetailLoader } from '~/features/transactions'

export const Route = createFileRoute('/accounts/$accountId/')({
  loader: ({ params }) => accountDetailLoader({ data: { accountId: params.accountId } }),
  component: () => <AccountDetailPage {...Route.useLoaderData()} />,
})
