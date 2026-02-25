import { createFileRoute, Outlet } from '@tanstack/react-router'

export const Route = createFileRoute('/accounts/$accountId/instruments')({
  component: () => <Outlet />,
})
