import type { AppFeature } from '~/core/features'

export const accountsFeature: AppFeature = {
  id: 'accounts',
  register(context) {
    context.registerNav({ to: '/accounts', label: 'Accounts' })
  },
}
