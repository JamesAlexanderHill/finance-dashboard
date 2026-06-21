'use client'

import * as React from 'react'
import { Popover } from '@base-ui/react/popover'
import { ChevronRight, ChevronLeft, X, Check } from 'lucide-react'
import cn from '~/lib/class-merge'
import type { Category } from '~/db/schema'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildPath(categoryId: string, categories: Category[]): Category[] {
  const path: Category[] = []
  let current = categories.find((c) => c.id === categoryId)
  while (current) {
    path.unshift(current)
    current = current.parentId ? categories.find((c) => c.id === current!.parentId) : undefined
  }
  return path
}

export function buildCategoryBreadcrumb(categoryId: string | null, categories: Category[]): string {
  if (!categoryId) return ''
  return buildPath(categoryId, categories)
    .map((c) => c.name)
    .join(' › ')
}

// ─── CategorySelector ─────────────────────────────────────────────────────────

interface CategorySelectorProps {
  value: string | null
  onChange: (id: string | null) => void
  categories: Category[]
  className?: string
}

export function CategorySelector({
  value,
  onChange,
  categories,
  className,
}: CategorySelectorProps) {
  const [isOpen, setIsOpen] = React.useState(false)
  const [drillPath, setDrillPath] = React.useState<Category[]>([])

  const currentParentId = drillPath.length > 0 ? drillPath[drillPath.length - 1].id : null
  const currentItems = categories.filter((c) => c.parentId === currentParentId)

  function handleOpenChange(open: boolean) {
    setIsOpen(open)
    if (!open) setDrillPath([])
  }

  function handleItemClick(cat: Category) {
    const hasChildren = categories.some((c) => c.parentId === cat.id)
    if (hasChildren) {
      setDrillPath([...drillPath, cat])
    } else {
      commit(cat.id)
    }
  }

  function handleAssignCurrent() {
    if (drillPath.length > 0) {
      commit(drillPath[drillPath.length - 1].id)
    }
  }

  function commit(id: string) {
    onChange(id)
    setIsOpen(false)
    setDrillPath([])
  }

  function handleClear(e: React.MouseEvent) {
    e.stopPropagation()
    onChange(null)
    setIsOpen(false)
    setDrillPath([])
  }

  const breadcrumb = value ? buildCategoryBreadcrumb(value, categories) : null

  return (
    <Popover.Root open={isOpen} onOpenChange={handleOpenChange}>
      <Popover.Trigger
        className={cn(
          'inline-flex items-center gap-1.5 text-xs rounded-full px-2.5 py-1 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-blue-500',
          value
            ? 'bg-blue-50 dark:bg-blue-950 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800 hover:bg-blue-100 dark:hover:bg-blue-900'
            : 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 border border-gray-200 dark:border-gray-700 hover:bg-gray-200 dark:hover:bg-gray-700',
          className,
        )}
      >
        <span className="max-w-[160px] truncate">{breadcrumb ?? 'Uncategorized'}</span>
        {value && (
          <span
            role="button"
            onClick={handleClear}
            className="shrink-0 -mr-0.5 rounded-full p-0.5 hover:bg-blue-200 dark:hover:bg-blue-800"
          >
            <X className="size-2.5" />
          </span>
        )}
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Positioner sideOffset={6} align="start" className="z-50">
          <Popover.Popup className="w-56 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg shadow-lg overflow-hidden data-open:animate-in data-closed:animate-out data-closed:fade-out-0 data-open:fade-in-0 duration-100">
            {/* Breadcrumb / back nav */}
            {drillPath.length > 0 && (
              <div className="flex items-center gap-1 px-2 py-2 border-b border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50">
                <button
                  onClick={() => setDrillPath(drillPath.slice(0, -1))}
                  className="shrink-0 p-0.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400"
                >
                  <ChevronLeft className="size-3.5" />
                </button>
                <span className="flex-1 text-xs text-gray-600 dark:text-gray-300 truncate font-medium">
                  {drillPath.map((c) => c.name).join(' › ')}
                </span>
                <button
                  onClick={handleAssignCurrent}
                  className="shrink-0 text-xs text-blue-600 dark:text-blue-400 hover:underline whitespace-nowrap"
                >
                  Use
                </button>
              </div>
            )}

            {/* Category list */}
            <ul className="py-1 max-h-60 overflow-y-auto">
              {currentItems.length === 0 && (
                <li className="px-3 py-2 text-xs text-gray-400 dark:text-gray-500 italic">
                  No categories
                </li>
              )}
              {currentItems.map((cat) => {
                const hasChildren = categories.some((c) => c.parentId === cat.id)
                const isSelected = cat.id === value
                return (
                  <li key={cat.id}>
                    <button
                      onClick={() => handleItemClick(cat)}
                      className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors outline-none"
                    >
                      <span className="size-3 shrink-0 flex items-center justify-center">
                        {isSelected && <Check className="size-3 text-blue-600 dark:text-blue-400" />}
                      </span>
                      <span className="flex-1 text-gray-700 dark:text-gray-300 truncate">
                        {cat.name}
                      </span>
                      {hasChildren && (
                        <ChevronRight className="size-3 text-gray-400 dark:text-gray-500 shrink-0" />
                      )}
                    </button>
                  </li>
                )
              })}
            </ul>

            {/* Clear footer */}
            {value && (
              <div className="border-t border-gray-100 dark:border-gray-800 px-3 py-1.5">
                <button
                  onClick={handleClear}
                  className="text-xs text-gray-400 dark:text-gray-500 hover:text-red-600 dark:hover:text-red-400 transition-colors"
                >
                  Clear category
                </button>
              </div>
            )}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  )
}
