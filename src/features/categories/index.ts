/**
 * Public contract of the categories feature (the workspace's category tree).
 * Other features and routes must import from here — never from `./domain/*`
 * or `./infrastructure/*` directly.
 */
export { categoryService } from './domain/category-service'
export { CategorySelector, buildCategoryBreadcrumb } from './ui/category-selector'
export { CategoryAssignWidget } from './ui/category-assign-widget'

export { categoriesFeature } from './feature'
