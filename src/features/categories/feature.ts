import type { AppFeature } from '~/core/features'

export const categoriesFeature: AppFeature = {
  id: 'categories',
  register(context) {
    context.registerNav({ to: '/categories', label: 'Categories' })
  },
}
