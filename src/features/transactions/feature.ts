import type { AppFeature } from '~/core/features'

export const transactionsFeature: AppFeature = {
  id: 'transactions',
  dependencies: ['accounts', 'categories', 'relations'],
  register(context) {
    context.registerNav({ to: '/events', label: 'Events' })
  },
}
