import { registry } from '~/features/registry'

registry.register({
  id: 'dashboard',
  client: {
    navLinks: [{ label: 'Dashboard', to: '/', exact: true }],
  },
})

export { DashboardPage, dashboardLoader } from './dashboard-page'
export type { DashboardPageData } from './dashboard-page'
