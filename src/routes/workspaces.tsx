import { createFileRoute } from '@tanstack/react-router'
import { WorkspacesPage, workspacesLoader } from '~/features/core'

export const Route = createFileRoute('/workspaces')({
  loader: workspacesLoader,
  component: () => <WorkspacesPage {...Route.useLoaderData()} />,
})
