import * as React from 'react'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { Plus, Pencil, Trash2, Check, X } from 'lucide-react'
import type { Category } from '~/db/schema'
import { categoryService, getSession } from '~/db/services'
import { Button } from '~/components/ui/button'

// ─── Server functions ─────────────────────────────────────────────────────────

const getData = createServerFn({ method: 'GET' }).handler(async () => {
  const session = await getSession()
  if (!session) return { user: null, categories: [] as Category[] }
  const cats = await categoryService.list(session.ctx)
  return { user: session.user, categories: cats }
})

const createCategory = createServerFn({ method: 'POST' })
  .inputValidator((d: unknown) => d as { name: string; parentId: string | null })
  .handler(async ({ data }) => {
    const session = await getSession()
    if (!session) throw new Error('Unauthorized')
    await categoryService.create(session.ctx, data.name, data.parentId)
  })

const renameCategory = createServerFn({ method: 'POST' })
  .inputValidator((d: unknown) => d as { id: string; name: string })
  .handler(async ({ data }) => {
    const session = await getSession()
    if (!session) throw new Error('Unauthorized')
    await categoryService.rename(session.ctx, data.id, data.name)
  })

const deleteCategory = createServerFn({ method: 'POST' })
  .inputValidator((d: unknown) => d as { id: string })
  .handler(async ({ data }) => {
    const session = await getSession()
    if (!session) throw new Error('Unauthorized')
    await categoryService.remove(session.ctx, data.id)
  })

// ─── Route ────────────────────────────────────────────────────────────────────

export const Route = createFileRoute('/categories')({
  loader: () => getData(),
  component: CategoriesPage,
})

// ─── Types ────────────────────────────────────────────────────────────────────

type TreeState = {
  editingId: string | null
  editName: string
  confirmDeleteId: string | null
  addingParentId: string | null | undefined // undefined = not showing; null = root; string = parent id
  newName: string
  error: string | null
}

// ─── Component ────────────────────────────────────────────────────────────────

function CategoriesPage() {
  const { user, categories } = Route.useLoaderData()
  const router = useRouter()

  const [state, setState] = React.useState<TreeState>({
    editingId: null,
    editName: '',
    confirmDeleteId: null,
    addingParentId: undefined,
    newName: '',
    error: null,
  })

  function patch(update: Partial<TreeState>) {
    setState((s) => ({ ...s, ...update }))
  }

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

  async function handleCreate() {
    const name = state.newName.trim()
    if (!name) return
    patch({ error: null })
    try {
      await createCategory({ data: { name, parentId: state.addingParentId ?? null } })
      patch({ newName: '', addingParentId: undefined })
      router.invalidate()
    } catch (e) {
      patch({ error: e instanceof Error ? e.message : 'Failed to create category' })
    }
  }

  async function handleRename() {
    const name = state.editName.trim()
    if (!name || !state.editingId) return
    patch({ error: null })
    try {
      await renameCategory({ data: { id: state.editingId, name } })
      patch({ editingId: null, editName: '' })
      router.invalidate()
    } catch (e) {
      patch({ error: e instanceof Error ? e.message : 'Failed to rename category' })
    }
  }

  async function handleDelete() {
    if (!state.confirmDeleteId) return
    patch({ error: null })
    try {
      await deleteCategory({ data: { id: state.confirmDeleteId } })
      patch({ confirmDeleteId: null })
      router.invalidate()
    } catch (e) {
      patch({ error: e instanceof Error ? e.message : 'Failed to delete category', confirmDeleteId: null })
    }
  }

  const sharedProps = {
    allCategories: categories,
    state,
    onStartEdit: (cat: Category) => patch({ editingId: cat.id, editName: cat.name, confirmDeleteId: null, addingParentId: undefined }),
    onEditNameChange: (v: string) => patch({ editName: v }),
    onConfirmRename: handleRename,
    onCancelEdit: () => patch({ editingId: null, editName: '' }),
    onStartDelete: (id: string) => patch({ confirmDeleteId: id, editingId: null, addingParentId: undefined }),
    onConfirmDelete: handleDelete,
    onCancelDelete: () => patch({ confirmDeleteId: null }),
    onStartAdd: (parentId: string) => patch({ addingParentId: parentId, editingId: null, confirmDeleteId: null, newName: '' }),
    onNewNameChange: (v: string) => patch({ newName: v }),
    onConfirmAdd: handleCreate,
    onCancelAdd: () => patch({ addingParentId: undefined, newName: '' }),
  }

  return (
    <div className="max-w-2xl">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">Categories</h1>
        <Button
          size="sm"
          onClick={() => patch({ addingParentId: null, newName: '', editingId: null, confirmDeleteId: null })}
        >
          <Plus className="size-3.5" />
          Add Category
        </Button>
      </div>

      {state.error && (
        <div className="mb-4 px-3 py-2 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-lg text-sm text-red-700 dark:text-red-400">
          {state.error}
          <button
            onClick={() => patch({ error: null })}
            className="ml-2 text-red-400 hover:text-red-600 dark:hover:text-red-300"
          >
            <X className="size-3.5 inline" />
          </button>
        </div>
      )}

      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl overflow-hidden">
        {categories.length === 0 && state.addingParentId === undefined ? (
          <p className="text-gray-500 dark:text-gray-400 text-sm p-4">
            No categories yet. Click "Add Category" to create one.
          </p>
        ) : (
          <CategoryTree nodes={roots} depth={0} {...sharedProps} />
        )}

        {/* Root-level add form */}
        {state.addingParentId === null && (
          <AddForm
            value={state.newName}
            placeholder="Root category name"
            depth={0}
            onChange={(v) => patch({ newName: v })}
            onConfirm={handleCreate}
            onCancel={() => patch({ addingParentId: undefined, newName: '' })}
          />
        )}
      </div>
    </div>
  )
}

// ─── Tree ─────────────────────────────────────────────────────────────────────

type SharedProps = {
  allCategories: Category[]
  state: TreeState
  onStartEdit: (cat: Category) => void
  onEditNameChange: (v: string) => void
  onConfirmRename: () => void
  onCancelEdit: () => void
  onStartDelete: (id: string) => void
  onConfirmDelete: () => void
  onCancelDelete: () => void
  onStartAdd: (parentId: string) => void
  onNewNameChange: (v: string) => void
  onConfirmAdd: () => void
  onCancelAdd: () => void
}

function CategoryTree({
  nodes,
  depth,
  allCategories,
  state,
  onStartEdit,
  onEditNameChange,
  onConfirmRename,
  onCancelEdit,
  onStartDelete,
  onConfirmDelete,
  onCancelDelete,
  onStartAdd,
  onNewNameChange,
  onConfirmAdd,
  onCancelAdd,
}: { nodes: Category[]; depth: number } & SharedProps) {
  return (
    <ul>
      {nodes.map((cat) => {
        const children = allCategories.filter((c) => c.parentId === cat.id)
        const isEditing = state.editingId === cat.id
        const isConfirmDelete = state.confirmDeleteId === cat.id
        const isAddingChild = state.addingParentId === cat.id
        const indent = depth * 20

        return (
          <li key={cat.id} className="border-b border-gray-100 dark:border-gray-800 last:border-b-0">
            {/* Row */}
            <div
              className="flex items-center gap-2 px-4 py-2.5 group"
              style={{ paddingLeft: `${16 + indent}px` }}
            >
              {depth > 0 && (
                <span className="text-gray-300 dark:text-gray-600 text-xs shrink-0">└</span>
              )}

              {isEditing ? (
                <div className="flex items-center gap-1.5 flex-1 min-w-0">
                  <input
                    autoFocus
                    value={state.editName}
                    onChange={(e) => onEditNameChange(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') onConfirmRename()
                      if (e.key === 'Escape') onCancelEdit()
                    }}
                    className="flex-1 min-w-0 text-sm px-2 py-0.5 border border-blue-400 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 outline-none"
                  />
                  <button
                    onClick={onConfirmRename}
                    className="p-0.5 text-green-600 hover:text-green-700 dark:text-green-500"
                  >
                    <Check className="size-4" />
                  </button>
                  <button
                    onClick={onCancelEdit}
                    className="p-0.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                  >
                    <X className="size-4" />
                  </button>
                </div>
              ) : isConfirmDelete ? (
                <div className="flex items-center gap-2 flex-1">
                  <span className="text-sm text-gray-500 dark:text-gray-400 line-through">{cat.name}</span>
                  <span className="text-xs text-red-600 dark:text-red-400 font-medium">Delete?</span>
                  <button
                    onClick={onConfirmDelete}
                    className="p-0.5 text-red-600 hover:text-red-700 dark:text-red-500"
                  >
                    <Check className="size-4" />
                  </button>
                  <button
                    onClick={onCancelDelete}
                    className="p-0.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                  >
                    <X className="size-4" />
                  </button>
                </div>
              ) : (
                <>
                  <span className="text-sm text-gray-800 dark:text-gray-200 flex-1">{cat.name}</span>
                  <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => onStartEdit(cat)}
                      title="Rename"
                      className="p-1 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 rounded"
                    >
                      <Pencil className="size-3.5" />
                    </button>
                    <button
                      onClick={() => onStartDelete(cat.id)}
                      title="Delete"
                      className="p-1 text-gray-400 hover:text-red-600 dark:hover:text-red-400 rounded"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                    <button
                      onClick={() => onStartAdd(cat.id)}
                      title="Add child category"
                      className="p-1 text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 rounded"
                    >
                      <Plus className="size-3.5" />
                    </button>
                  </div>
                </>
              )}
            </div>

            {/* Children */}
            {children.length > 0 && (
              <CategoryTree
                nodes={children}
                depth={depth + 1}
                allCategories={allCategories}
                state={state}
                onStartEdit={onStartEdit}
                onEditNameChange={onEditNameChange}
                onConfirmRename={onConfirmRename}
                onCancelEdit={onCancelEdit}
                onStartDelete={onStartDelete}
                onConfirmDelete={onConfirmDelete}
                onCancelDelete={onCancelDelete}
                onStartAdd={onStartAdd}
                onNewNameChange={onNewNameChange}
                onConfirmAdd={onConfirmAdd}
                onCancelAdd={onCancelAdd}
              />
            )}

            {/* Add child form */}
            {isAddingChild && (
              <AddForm
                value={state.newName}
                placeholder={`Child of "${cat.name}"`}
                depth={depth + 1}
                onChange={onNewNameChange}
                onConfirm={onConfirmAdd}
                onCancel={onCancelAdd}
              />
            )}
          </li>
        )
      })}
    </ul>
  )
}

// ─── Add form ─────────────────────────────────────────────────────────────────

function AddForm({
  value,
  placeholder,
  depth,
  onChange,
  onConfirm,
  onCancel,
}: {
  value: string
  placeholder: string
  depth: number
  onChange: (v: string) => void
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <div
      className="flex items-center gap-2 px-4 py-2 border-t border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50"
      style={{ paddingLeft: `${16 + depth * 20}px` }}
    >
      <input
        autoFocus
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onConfirm()
          if (e.key === 'Escape') onCancel()
        }}
        placeholder={placeholder}
        className="flex-1 min-w-0 text-sm px-2 py-1 border border-blue-400 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 outline-none placeholder:text-gray-400 dark:placeholder:text-gray-500"
      />
      <button
        onClick={onConfirm}
        className="p-1 text-green-600 hover:text-green-700 dark:text-green-500 disabled:opacity-40"
        disabled={!value.trim()}
      >
        <Check className="size-4" />
      </button>
      <button
        onClick={onCancel}
        className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
      >
        <X className="size-4" />
      </button>
    </div>
  )
}
