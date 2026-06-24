import { useRouter } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { createServerFn } from '@tanstack/react-start'
import { eq, and } from 'drizzle-orm'
import { db } from '~/db'
import { legs } from '~/db/schema'
import type { Instrument, DecoratedEvent } from '~/db/types'
import Table, { ColumnDef } from '../ui/table'
import formatDate from '~/lib/format-date'
import Badge from '../ui/badge'
import { formatChange } from '~/lib/format'
import { PaginationData } from '~/db/services/utils/pagination'
import { categoryService, getSession } from '~/db/services'
import { CategorySelector } from '~/components/ui/category-selector'

// ─── Server functions ─────────────────────────────────────────────────────────

const getCategories = createServerFn({ method: 'GET' }).handler(async () => {
  const session = await getSession()
  if (!session) return []
  return categoryService.list(session.ctx)
})

const updateLegCategory = createServerFn({ method: 'POST' })
  .inputValidator((d: unknown) => d as { legId: string; categoryId: string | null })
  .handler(async ({ data }) => {
    const session = await getSession()
    if (!session) throw new Error('Unauthorized')
    await db
      .update(legs)
      .set({ categoryId: data.categoryId })
      .where(and(eq(legs.id, data.legId), eq(legs.workspaceId, session.workspace.id)))
  })

// ─── Component ────────────────────────────────────────────────────────────────

type EventTableProps = {
  events: DecoratedEvent[]
  hideColumns?: string[]
  pagination: PaginationData
  onPaginationChange?: (pagination: { page: number; pageSize: number }) => void
  onRowClick?: (row: DecoratedEvent) => void
}

export default function EventTable({
  events,
  pagination,
  hideColumns = [],
  onRowClick,
  onPaginationChange,
}: EventTableProps) {
  const router = useRouter()

  const { data: categories = [] } = useQuery({
    queryKey: ['categories'],
    queryFn: () => getCategories(),
    staleTime: 60_000,
  })

  async function handleCategoryChange(legId: string, categoryId: string | null) {
    await updateLegCategory({ data: { legId, categoryId } })
    router.invalidate()
  }

  const columns: ColumnDef<DecoratedEvent>[] = [
    {
      id: 'date',
      header: 'Date',
      cell: ({ row }) => (
        <span className="text-gray-500 dark:text-gray-400 whitespace-nowrap">
          {formatDate(row.original.effectiveAt)}
        </span>
      ),
    },
    {
      id: 'account',
      header: 'Account',
      cell: ({ row }) => (
        <span className="text-gray-500 dark:text-gray-400 text-xs truncate max-w-[8rem]">
          {row.original.account.name ?? '—'}
        </span>
      ),
    },
    {
      id: 'description',
      header: 'Description',
      cell: ({ row }) => (
        <span className="text-gray-900 dark:text-gray-100 font-medium">
          {row.original.description}
        </span>
      ),
    },
    {
      id: 'category',
      header: 'Category',
      cell: ({ row }) => {
        const eventLegs = row.original.legs
        const firstLeg = eventLegs[0]
        if (!firstLeg) return null

        return (
          // stopPropagation so clicking the selector doesn't open the event drawer
          <div
            className="flex items-center gap-1.5"
            onClick={(e) => e.stopPropagation()}
          >
            <CategorySelector
              value={firstLeg.categoryId ?? null}
              onChange={(id) => handleCategoryChange(firstLeg.id, id)}
              categories={categories}
            />
            {eventLegs.length > 1 && (
              <span className="text-xs text-gray-400 dark:text-gray-500 shrink-0">
                +{eventLegs.length - 1}
              </span>
            )}
          </div>
        )
      },
    },
    {
      id: 'change',
      header: 'Change',
      cell: ({ row }) => {
        const instrumentNetChange: Record<string, [Instrument, bigint]> = row.original.legs.reduce(
          (acc, leg) => {
            const instrumentId = leg.instrumentId
            acc[instrumentId] = [
              leg.instrument,
              (acc[instrumentId]?.[1] ?? BigInt(0)) + leg.unitCount,
            ]
            return acc
          },
          {} as Record<string, [Instrument, bigint]>,
        )

        return (
          <div className="flex gap-2">
            {Object.entries(instrumentNetChange).map(([instrumentId, [instrument, totalUnitCount]]) => {
              if (!instrument) return null
              const neg = totalUnitCount < 0
              return (
                <Badge key={instrumentId} color={neg ? 'red' : 'green'}>
                  {formatChange(totalUnitCount, instrument)}
                </Badge>
              )
            })}
          </div>
        )
      },
    },
  ]

  return (
    <Table
      data={events}
      columns={columns}
      onRowClick={onRowClick}
      getRowId={(row) => row.id}
      showColumnVisibilityToggle={true}
      pagination={pagination}
      hidePagination={pagination.total < pagination.limit}
      onPaginationChange={onPaginationChange}
      initialColumnVisibility={hideColumns.reduce(
        (acc, columnId) => {
          acc[columnId] = false
          return acc
        },
        {} as Record<string, boolean>,
      )}
    >
      <p>No events yet.</p>
    </Table>
  )
}
