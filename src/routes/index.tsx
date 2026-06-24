import { createFileRoute } from '@tanstack/react-router'
import { DashboardPage, dashboardLoader } from '~/features/dashboard'

export const Route = createFileRoute('/')({
  loader: dashboardLoader,
  component: () => <DashboardPage {...Route.useLoaderData()} />,
})
