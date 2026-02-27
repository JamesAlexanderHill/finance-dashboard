import { useState } from 'react'
import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  type ColumnDef,
  type VisibilityState,
  type RowData,
} from '@tanstack/react-table'

// ─── Types ───────────────────────────────────────────────────────────────────

export interface PaginationInfo {
  page: number
  pageSize: number
  totalCount: number
}

export interface PaginatedTableProps<TData extends RowData> {
  /** Data array from route loader (SSR'd) */
  data: TData[]
  /** TanStack Table column definitions */
  columns: ColumnDef<TData, any>[]
  /** Pagination info from route loader */
  pagination: PaginationInfo
  /** Called when pagination changes - typically calls navigate({ search: { page, pageSize } }) */
  onPaginationChange: (pagination: { page: number; pageSize: number }) => void
  /** Available page size options */
  pageSizeOptions?: number[]
  /** Hide pagination controls (for simple tables) */
  hidePagination?: boolean
  /** Called when a row is clicked - useful for navigation */
  onRowClick?: (row: TData) => void
  /** Function to get unique row ID */
  getRowId?: (row: TData) => string
  /** Show column visibility toggle dropdown */
  showColumnVisibilityToggle?: boolean
  /** Custom empty state content */
  children?: React.ReactNode
}

// Re-export ColumnDef for consumer convenience
export type { ColumnDef } from '@tanstack/react-table'

// ─── Column Visibility Dropdown ──────────────────────────────────────────────

function ColumnVisibilityDropdown<TData>({
  table,
}: {
  table: ReturnType<typeof useReactTable<TData>>
}) {
  const [open, setOpen] = useState(false)

  return (
    <div className="relative mb-4">
      <button
        onClick={() => setOpen(!open)}
        className="px-3 py-1.5 text-sm border border-gray-200 dark:border-gray-700 rounded-md hover:bg-gray-50 dark:hover:bg-gray-800 flex items-center gap-2"
      >
        <svg
          className="w-4 h-4"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2"
          />
        </svg>
        Columns
      </button>

      {open && (
        <>
          {/* Backdrop to close on click outside */}
          <div
            className="fixed inset-0 z-10"
            onClick={() => setOpen(false)}
          />
          <div className="absolute top-full left-0 mt-1 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-md shadow-lg p-2 z-20 min-w-[150px]">
            {table.getAllLeafColumns().map((column) => (
              <label
                key={column.id}
                className="flex items-center gap-2 px-2 py-1.5 text-sm hover:bg-gray-50 dark:hover:bg-gray-800 rounded cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={column.getIsVisible()}
                  onChange={column.getToggleVisibilityHandler()}
                  className="rounded border-gray-300 dark:border-gray-600"
                />
                <span className="text-gray-700 dark:text-gray-300">
                  {typeof column.columnDef.header === 'string'
                    ? column.columnDef.header
                    : column.id}
                </span>
              </label>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

// ─── Main Component ──────────────────────────────────────────────────────────

const DEFAULT_PAGE_SIZE_OPTIONS = [10, 20, 50, 100]

export default function PaginatedTable<TData extends RowData>({
  data,
  columns,
  pagination,
  onPaginationChange,
  pageSizeOptions = DEFAULT_PAGE_SIZE_OPTIONS,
  hidePagination = false,
  onRowClick,
  getRowId,
  showColumnVisibilityToggle = false,
  children,
}: PaginatedTableProps<TData>) {
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({})

  const table = useReactTable({
    data,
    columns,
    state: {
      columnVisibility,
    },
    onColumnVisibilityChange: setColumnVisibility,
    getCoreRowModel: getCoreRowModel(),
    getRowId: getRowId ?? ((_, index) => String(index)),
    manualPagination: true,
  })

  const totalPages = Math.ceil(pagination.totalCount / pagination.pageSize)

  // Empty state
  if (data.length === 0) {
    return (
      <div className="text-gray-500 dark:text-gray-400 text-sm">
        {children ?? 'No data available.'}
      </div>
    )
  }

  return (
    <div>
      {/* Column visibility toggle */}
      {showColumnVisibilityToggle && <ColumnVisibilityDropdown table={table} />}

      {/* Table */}
      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            {table.getHeaderGroups().map((headerGroup) => (
              <tr
                key={headerGroup.id}
                className="border-b border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50"
              >
                {headerGroup.headers.map((header) => (
                  <th
                    key={header.id}
                    className="text-left px-4 py-3 font-medium text-gray-500 dark:text-gray-400"
                  >
                    {header.isPlaceholder
                      ? null
                      : flexRender(
                          header.column.columnDef.header,
                          header.getContext()
                        )}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
            {table.getRowModel().rows.map((row) => (
              <tr
                key={row.id}
                onClick={onRowClick ? () => onRowClick(row.original) : undefined}
                className={`hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors ${
                  onRowClick ? 'cursor-pointer' : ''
                }`}
              >
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id} className="px-4 py-3">
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {!hidePagination && (totalPages > 1 || pageSizeOptions.length > 1) && (
        <div className="flex items-center justify-between mt-4">
          <div className="flex items-center gap-4">
            {/* Page size selector */}
            {pageSizeOptions.length > 1 && (
              <div className="flex items-center gap-2">
                <label
                  htmlFor="page-size"
                  className="text-sm text-gray-500 dark:text-gray-400"
                >
                  Show
                </label>
                <select
                  id="page-size"
                  value={pagination.pageSize}
                  onChange={(e) =>
                    onPaginationChange({ page: 1, pageSize: Number(e.target.value) })
                  }
                  className="px-2 py-1.5 text-sm border border-gray-200 dark:border-gray-700 rounded-md bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
                >
                  {pageSizeOptions.map((size) => (
                    <option key={size} value={size}>
                      {size}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {/* Page info */}
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Page {pagination.page} of {totalPages}
            </p>
          </div>
          {/* Page navigation */}
          {totalPages > 1 && (
            <div className="flex gap-2">
              <button
                onClick={() =>
                  onPaginationChange({ page: pagination.page - 1, pageSize: pagination.pageSize })
                }
                disabled={pagination.page <= 1}
                className="px-3 py-1.5 text-sm border border-gray-200 dark:border-gray-700 rounded-md disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50 dark:hover:bg-gray-800"
              >
                Previous
              </button>
              <button
                onClick={() =>
                  onPaginationChange({ page: pagination.page + 1, pageSize: pagination.pageSize })
                }
                disabled={pagination.page >= totalPages}
                className="px-3 py-1.5 text-sm border border-gray-200 dark:border-gray-700 rounded-md disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50 dark:hover:bg-gray-800"
              >
                Next
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
