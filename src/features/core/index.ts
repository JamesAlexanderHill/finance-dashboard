import { registry } from '~/features/registry'

registry.register({
  id: 'core',
  // Core has no nav links — it provides the app shell itself
})

export { Sidebar, RootDocument } from './app-shell'
export { LoginPage } from './login-page'
export { SettingsPage, settingsLoader } from './settings-page'
export type { SettingsPageData } from './settings-page'
export { WorkspacesPage, workspacesLoader } from './workspaces-page'
export type { WorkspacesPageData } from './workspaces-page'
