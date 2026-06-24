import { registry } from '~/features/registry'

registry.register({
  id: 'categories',
  client: {
    navLinks: [{ label: 'Categories', to: '/categories' }],
  },
})

export { CategoriesPage, categoriesLoader } from './categories-page'
export type { CategoriesPageData } from './categories-page'
export { CategorySelector, buildCategoryBreadcrumb } from './components/category-selector'
export type { Category } from './schema'
