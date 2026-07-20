import * as React from 'react'
import { useRouter } from '@tanstack/react-router'
import { useQuery, useQueries } from '@tanstack/react-query'
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
import { categoryService, subEventService, getSession } from '~/db/services'
import { querySubEventCountsForEvents } from '~/db/services/query/sub-event'
import { CategorySelector } from '~/components/ui/category-selector'
import { EventLegBar } from '~/components/event/event-leg-bar'

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

const getSubEventCounts = createServerFn({ method: 'GET' })
  .inputValidator((d: unknown) => d as { eventIds: string[] })
  .handler(async ({ data }) => {
    const session = await getSession()
    if (!session) return []
    const counts = await querySubEventCountsForEvents(session.workspace.id, data.eventIds)
    return [...counts.entries()]
  })

const getSubEventChildren = createServerFn({ method: 'GET' })
  .inputValidator((d: unknown) => d as { parentEventId: string })
  .handler(async ({ data }) => {
    const session = await getSession()
    if (!session) return []
    return subEventService.listChildren(session.ctx, data.parentEventId)
  })

// ─── Component ────────────────────────────────────────────────────────────────

type EventTableProps = {
  events: DecoratedEvent[]
  hideColumns?: string[]
  pagination: PaginationData
  onPaginationChange?: (pagination: { page: number; pageSize: number }) => void
  onRowClick?: (row: DecoratedEvent) => void
}

// A parent's linked sub-events, flattened into the table as indented child
// rows immediately below it when expanded. Purely a display concern — page
// size/`pagination.total` still count only top-level events.
type DisplayRow = DecoratedEvent & { isSubEventChild?: boolean }

export default function EventTable({
  events,
  pagination,
  hideColumns = [],
  onRowClick,
  onPaginationChange,
}: EventTableProps) {
  const router = useRouter()
  const [expandedParents, setExpandedParents] = React.useState<Set<string>>(new Set())

  const { data: categories = [] } = useQuery({
    queryKey: ['categories'],
    queryFn: () => getCategories(),
    staleTime: 60_000,
  })

  const eventIds = React.useMemo(() => events.map((e) => e.id), [events])
  const { data: subEventCountRows = [] } = useQuery({
    queryKey: ['sub-event-counts', eventIds],
    queryFn: () => getSubEventCounts({ data: { eventIds } }),
    enabled: eventIds.length > 0,
  })
  const subEventCounts = React.useMemo(() => new Map(subEventCountRows), [subEventCountRows])

  const expandedIds = [...expandedParents]
  const childQueries = useQueries({
    queries: expandedIds.map((parentEventId) => ({
      queryKey: ['sub-event-children', parentEventId],
      queryFn: () => getSubEventChildren({ data: { parentEventId } }),
    })),
  })
  const childrenByParent = React.useMemo(() => {
    const map = new Map<string, DecoratedEvent[]>()
    expandedIds.forEach((parentEventId, i) => {
      const data = childQueries[i]?.data
      if (data) map.set(parentEventId, data as DecoratedEvent[])
    })
    return map
  }, [expandedIds, childQueries])

  function toggleExpanded(eventId: string) {
    setExpandedParents((prev) => {
      const next = new Set(prev)
      if (next.has(eventId)) next.delete(eventId)
      else next.add(eventId)
      return next
    })
  }

  async function handleCategoryChange(legId: string, categoryId: string | null) {
    await updateLegCategory({ data: { legId, categoryId } })
    router.invalidate()
  }

  const displayRows: DisplayRow[] = React.useMemo(() => {
    const rows: DisplayRow[] = []
    for (const event of events) {
      rows.push(event)
      if (expandedParents.has(event.id)) {
        const children = childrenByParent.get(event.id) ?? []
        for (const child of children) rows.push({ ...child, isSubEventChild: true })
      }
    }
    return rows
  }, [events, expandedParents, childrenByParent])

  const columns: ColumnDef<DisplayRow>[] = [
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
      cell: ({ row }) => {
        const childCount = subEventCounts.get(row.original.id) ?? 0
        const isExpanded = expandedParents.has(row.original.id)
        const childEvents = childrenByParent.get(row.original.id)
        return (
          <div className={row.original.isSubEventChild ? 'pl-4 border-l-2 border-gray-100 dark:border-gray-800' : undefined}>
            <div className="flex items-center gap-1.5">
              <span className="text-gray-900 dark:text-gray-100 font-medium">
                {row.original.description}
              </span>
              {childCount > 0 && (
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    toggleExpanded(row.original.id)
                  }}
                  className="text-xs text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 inline-flex items-center gap-0.5"
                >
                  {childCount}
                  <svg
                    className={`w-3 h-3 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
              )}
            </div>
            <EventLegBar
              legs={row.original.legs}
              categories={categories}
              childEvents={childCount > 0 ? childEvents : undefined}
            />
          </div>
        )
      },
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
      data={displayRows}
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
