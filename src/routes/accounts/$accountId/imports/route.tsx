import { createFileRoute, Outlet } from '@tanstack/react-router'

export const Route = createFileRoute('/accounts/$accountId/imports')({
  component: () => <Outlet />,
})
