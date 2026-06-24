import { createFileRoute } from '@tanstack/react-router'
import { CategoriesPage, categoriesLoader } from '~/features/categories'

export const Route = createFileRoute('/categories')({
  loader: categoriesLoader,
  component: () => <CategoriesPage {...Route.useLoaderData()} />,
})
