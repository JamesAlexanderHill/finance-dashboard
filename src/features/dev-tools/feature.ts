import type { AppFeature } from '~/core/features'

export const devToolsFeature: AppFeature = {
  id: 'dev-tools',
  // Seeds/clears data across every other feature's tables, so it depends on
  // all of them being registered first even though it calls the shared
  // database schema directly rather than their service layers.
  dependencies: ['accounts', 'transactions', 'categories', 'relations', 'imports'],
  register(context) {
    context.registerNav({ to: '/dev', label: 'Dev Tools', devOnly: true })
  },
}
