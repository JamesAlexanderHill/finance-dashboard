import { createFileRoute } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { eq, isNull } from 'drizzle-orm'
import { db } from '~/db'
import { users, categories } from '~/db/schema'
import type { Category } from '~/db/schema'

// ─── Server function ──────────────────────────────────────────────────────────

const getCategoriesData = createServerFn({ method: 'GET' }).handler(async () => {
  const [user] = await db.select().from(users).limit(1)
  if (!user) return { user: null, categories: [] }
  const cats = await db
    .select()
    .from(categories)
    .where(eq(categories.userId, user.id))
  return { user, categories: cats }
})

// ─── Route ────────────────────────────────────────────────────────────────────

export const Route = createFileRoute('/categories')({
  loader: () => getCategoriesData(),
  component: CategoriesPage,
})

// ─── Component ────────────────────────────────────────────────────────────────

function CategoriesPage() {
  const { user, categories } = Route.useLoaderData()

  if (!user) {
    return (
      <div className="text-gray-500 dark:text-gray-400 text-sm">
        No user found. Visit{' '}
        <a href="/dev" className="text-blue-600 dark:text-blue-400 underline">
          Dev Tools
        </a>
        .
      </div>
    )
  }

  const roots = categories.filter((c) => c.parentId === null)

  return (
    <div className="max-w-2xl">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">Categories</h1>
        <span className="text-xs text-gray-400 dark:text-gray-500 bg-gray-100 dark:bg-gray-800 px-2 py-1 rounded">
          Read-only — manage via Dev Tools
        </span>
      </div>

      {categories.length === 0 ? (
        <p className="text-gray-500 dark:text-gray-400 text-sm">
          No categories yet. Seed them via Dev Tools.
        </p>
      ) : (
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4">
          <CategoryTree nodes={roots} allCategories={categories} depth={0} />
        </div>
      )}
    </div>
  )
}

// ─── Recursive tree ───────────────────────────────────────────────────────────

function CategoryTree({
  nodes,
  allCategories,
  depth,
}: {
  nodes: Category[]
  allCategories: Category[]
  depth: number
}) {
  return (
    <ul className={depth > 0 ? 'ml-4 mt-1 space-y-1' : 'space-y-1'}>
      {nodes.map((cat) => {
        const children = allCategories.filter((c) => c.parentId === cat.id)
        return (
          <li key={cat.id}>
            <div className="flex items-center gap-2 py-1">
              {depth > 0 && (
                <span className="text-gray-300 dark:text-gray-600 text-xs">└</span>
              )}
              <span className="text-sm text-gray-800 dark:text-gray-200">{cat.name}</span>
            </div>
            {children.length > 0 && (
              <CategoryTree
                nodes={children}
                allCategories={allCategories}
                depth={depth + 1}
              />
            )}
          </li>
        )
      })}
    </ul>
  )
}
