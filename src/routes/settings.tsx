import { createFileRoute } from '@tanstack/react-router'
import { SettingsPage, settingsLoader } from '~/features/core'

export const Route = createFileRoute('/settings')({
  loader: settingsLoader,
  component: () => <SettingsPage account={Route.useLoaderData()} />,
})
