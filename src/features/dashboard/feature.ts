import type { AppFeature } from '~/core/features'

export const dashboardFeature: AppFeature = {
  id: 'dashboard',
  dependencies: ['accounts', 'relations'],
  register(context) {
    context.registerNav({ to: '/', label: 'Dashboard', exact: true })
  },
}
