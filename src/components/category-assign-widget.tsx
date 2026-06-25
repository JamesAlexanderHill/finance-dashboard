'use client'

import * as React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createServerFn } from '@tanstack/react-start'
import { Dialog } from '@base-ui/react/dialog'
import { and, eq, inArray } from 'drizzle-orm'
import { X, Tag } from 'lucide-react'
import { db } from '~/db'
import { legs } from '~/db/schema'
import type { Category } from '~/db/schema'
import type { DecoratedEvent } from '~/db/types'
import { eventService, getSession } from '~/db/services'
import { CategorySelector, buildCategoryBreadcrumb } from '~/components/ui/category-selector'
import { Button } from '~/components/ui/button'
import Badge from '~/components/ui/badge'
import formatDate from '~/lib/format-date'
import { formatChange } from '~/lib/format'

// ─── Server functions ─────────────────────────────────────────────────────────

const PAGE_SIZE = 10

const getUncategorizedEvents = createServerFn({ method: 'GET' })
  .inputValidator((d: unknown) => d as { offset: number })
  .handler(async ({ data }) => {
    const session = await getSession()
    if (!session) return { data: [] as DecoratedEvent[], pagination: { total: 0, limit: PAGE_SIZE, offset: 0, hasNext: false } }
    return eventService.listUncategorized(session.ctx, { limit: PAGE_SIZE, offset: data.offset })
  })

const getSimilarEvents = createServerFn({ method: 'GET' })
  .inputValidator((d: unknown) => d as { eventId: string; description: string; unitCount: string })
  .handler(async ({ data }) => {
    const session = await getSession()
    if (!session) return [] as DecoratedEvent[]
    return eventService.listSimilarUncategorized(
      session.ctx,
      data.eventId,
      data.description,
      BigInt(data.unitCount),
    )
  })

const bulkAssignCategory = createServerFn({ method: 'POST' })
  .inputValidator((d: unknown) => d as { legIds: string[]; categoryId: string })
  .handler(async ({ data }) => {
    const session = await getSession()
    if (!session) throw new Error('Unauthorized')
    if (data.legIds.length === 0) return
    await db
      .update(legs)
      .set({ categoryId: data.categoryId })
      .where(and(inArray(legs.id, data.legIds), eq(legs.workspaceId, session.workspace.id)))
  })

// ─── Main widget ──────────────────────────────────────────────────────────────

type Props = {
  categories: Category[]
}

export function CategoryAssignWidget({ categories }: Props) {
  const queryClient = useQueryClient()
  const [page, setPage] = React.useState(0)
  const [selectedEvent, setSelectedEvent] = React.useState<DecoratedEvent | null>(null)

  const { data, isFetching } = useQuery({
    queryKey: ['uncategorized-events', page],
    queryFn: () => getUncategorizedEvents({ data: { offset: page * PAGE_SIZE } }),
    staleTime: 0,
  })

  const events = data?.data ?? []
  const total = data?.pagination.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  function handleAssigned() {
    setSelectedEvent(null)
    // If we just emptied the current page, step back one
    setPage((p) => (p > 0 && events.length === 1 ? p - 1 : p))
    queryClient.invalidateQueries({ queryKey: ['uncategorized-events'] })
  }

  return (
    <section className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-gray-800">
        <div className="flex items-center gap-2">
          <Tag className="size-4 text-gray-400 dark:text-gray-500" />
          <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Uncategorized Transactions</h2>
          {total > 0 && (
            <span className="text-xs bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-400 px-1.5 py-0.5 rounded-full font-medium">
              {total}
            </span>
          )}
        </div>
      </div>

      {isFetching && events.length === 0 ? (
        <div className="px-4 py-8 text-sm text-gray-400 dark:text-gray-500 text-center">Loading…</div>
      ) : events.length === 0 ? (
        <div className="px-4 py-8 text-sm text-gray-400 dark:text-gray-500 text-center">
          All transactions are categorized.
        </div>
      ) : (
        <>
          <ul className="divide-y divide-gray-100 dark:divide-gray-800">
            {events.map((event) => (
              <li key={event.id}>
                <button
                  onClick={() => setSelectedEvent(event)}
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors group"
                >
                  <span className="text-xs text-gray-400 dark:text-gray-500 w-20 shrink-0">
                    {formatDate(event.effectiveAt)}
                  </span>
                  <span className="flex-1 min-w-0 text-sm text-gray-800 dark:text-gray-200 truncate">
                    {event.description}
                  </span>
                  <span className="text-xs text-gray-400 dark:text-gray-500 shrink-0 truncate max-w-[5rem]">
                    {event.account.name}
                  </span>
                  <div className="flex gap-1 shrink-0">
                    {Object.entries(
                      event.legs.reduce(
                        (acc, leg) => {
                          acc[leg.instrumentId] = [leg.instrument, (acc[leg.instrumentId]?.[1] ?? 0n) + leg.unitCount]
                          return acc
                        },
                        {} as Record<string, [typeof event.legs[0]['instrument'], bigint]>,
                      ),
                    ).map(([id, [instrument, total]]) => (
                      <Badge key={id} color={total < 0n ? 'red' : 'green'}>
                        {formatChange(total, instrument)}
                      </Badge>
                    ))}
                  </div>
                </button>
              </li>
            ))}
          </ul>

          <div className={`flex items-center justify-between px-4 py-2.5 border-t border-gray-100 dark:border-gray-800 text-xs ${isFetching ? 'opacity-50' : ''}`}>
            <span className="text-gray-500 dark:text-gray-400">
              Page {page + 1} of {totalPages}
              <span className="text-gray-400 dark:text-gray-500 ml-1">({total} total)</span>
            </span>
            <div className="flex gap-1">
              <Button size="xs" variant="outline" disabled={page === 0 || isFetching} onClick={() => setPage(0)}>
                «
              </Button>
              <Button size="xs" variant="outline" disabled={page === 0 || isFetching} onClick={() => setPage((p) => p - 1)}>
                Prev
              </Button>
              <Button size="xs" variant="outline" disabled={page + 1 >= totalPages || isFetching} onClick={() => setPage((p) => p + 1)}>
                Next
              </Button>
              <Button size="xs" variant="outline" disabled={page + 1 >= totalPages || isFetching} onClick={() => setPage(totalPages - 1)}>
                »
              </Button>
            </div>
          </div>
        </>
      )}

      {selectedEvent && (
        <AssignModal
          event={selectedEvent}
          categories={categories}
          onClose={() => setSelectedEvent(null)}
          onAssigned={handleAssigned}
        />
      )}
    </section>
  )
}

// ─── Assign modal ─────────────────────────────────────────────────────────────

type AssignModalProps = {
  event: DecoratedEvent
  categories: Category[]
  onClose: () => void
  onAssigned: () => void
}

function AssignModal({ event, categories, onClose, onAssigned }: AssignModalProps) {
  const [open, setOpen] = React.useState(true)
  const [categoryId, setCategoryId] = React.useState<string | null>(null)
  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(new Set())
  const [submitting, setSubmitting] = React.useState(false)

  function handleOpenChange(next: boolean) {
    if (!next) {
      setOpen(false)
      setTimeout(onClose, 150)
    }
  }

  const firstLeg = event.legs[0]

  const { data: similar = [], isFetching: loadingSimilar } = useQuery({
    queryKey: ['similar-events', event.id],
    queryFn: () =>
      getSimilarEvents({
        data: {
          eventId: event.id,
          description: event.description,
          unitCount: String(firstLeg?.unitCount ?? 0n),
        },
      }),
    enabled: !!firstLeg,
    staleTime: 0,
  })

  function toggleId(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleAll() {
    if (selectedIds.size === similar.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(similar.map((e) => e.id)))
    }
  }

  async function handleAssign() {
    if (!categoryId || !firstLeg) return
    setSubmitting(true)
    try {
      // Collect: first leg of selected event + first leg of each selected similar event
      const legIds = [firstLeg.id]
      for (const ev of similar) {
        if (selectedIds.has(ev.id) && ev.legs[0]) {
          legIds.push(ev.legs[0].id)
        }
      }
      await bulkAssignCategory({ data: { legIds, categoryId } })
      setOpen(false)
      setTimeout(onAssigned, 150)
    } finally {
      setSubmitting(false)
    }
  }

  const assignCount = 1 + selectedIds.size
  const allSimilarSelected = similar.length > 0 && selectedIds.size === similar.length

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 bg-black/40 z-50 data-open:animate-in data-closed:animate-out data-open:fade-in-0 data-closed:fade-out-0 duration-150" />
        <Dialog.Popup className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl shadow-2xl w-full max-w-xl max-h-[85vh] flex flex-col data-open:animate-in data-closed:animate-out data-open:fade-in-0 data-closed:fade-out-0 data-open:zoom-in-95 data-closed:zoom-out-95 duration-150">
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-800 shrink-0">
            <Dialog.Title className="text-base font-semibold text-gray-900 dark:text-gray-100">
              Categorize Transaction
            </Dialog.Title>
            <Dialog.Close
              render={
                <button className="p-1 rounded text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800">
                  <X className="size-4" />
                </button>
              }
            />
          </div>

          {/* Scrollable body */}
          <div className="flex-1 overflow-y-auto">
            {/* Selected transaction */}
            <div className="px-5 pt-4 pb-3">
              <div className="rounded-lg border border-blue-100 dark:border-blue-900 bg-blue-50 dark:bg-blue-950/30 p-3">
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{event.description}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                      {formatDate(event.effectiveAt)} · {event.account.name}
                    </p>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    {event.legs.map((leg) => (
                      <Badge key={leg.id} color={leg.unitCount < 0n ? 'red' : 'green'}>
                        {formatChange(leg.unitCount, leg.instrument)}
                      </Badge>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* Category picker */}
            <div className="px-5 pb-4">
              <label className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1.5 block">
                Assign Category
              </label>
              <CategorySelector
                value={categoryId}
                onChange={setCategoryId}
                categories={categories}
              />
              {categoryId && (
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                  {buildCategoryBreadcrumb(categoryId, categories)}
                </p>
              )}
            </div>

            {/* Similar transactions */}
            <div className="border-t border-gray-100 dark:border-gray-800">
              <div className="flex items-center justify-between px-5 py-3">
                <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                  {loadingSimilar ? 'Loading similar…' : similar.length > 0 ? `${similar.length} Similar Transaction${similar.length === 1 ? '' : 's'}` : 'No Similar Transactions'}
                </p>
                {similar.length > 0 && (
                  <button
                    onClick={toggleAll}
                    className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
                  >
                    {allSimilarSelected ? 'Deselect all' : 'Select all'}
                  </button>
                )}
              </div>

              {similar.length > 0 && (
                <ul className="divide-y divide-gray-100 dark:divide-gray-800 pb-2">
                  {similar.map((ev) => {
                    const checked = selectedIds.has(ev.id)
                    const evFirstLeg = ev.legs[0]
                    return (
                      <li key={ev.id}>
                        <label className="flex items-center gap-3 px-5 py-2.5 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleId(ev.id)}
                            className="size-4 rounded border-gray-300 dark:border-gray-600 text-blue-600 accent-blue-600"
                          />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm text-gray-800 dark:text-gray-200 truncate">{ev.description}</p>
                            <p className="text-xs text-gray-400 dark:text-gray-500">
                              {formatDate(ev.effectiveAt)} · {ev.account.name}
                              {ev.legs[0]?.categoryId && (
                                <span className="ml-1 text-blue-500 dark:text-blue-400">
                                  · {buildCategoryBreadcrumb(ev.legs[0].categoryId, categories)}
                                </span>
                              )}
                            </p>
                          </div>
                          {evFirstLeg && (
                            <Badge color={evFirstLeg.unitCount < 0n ? 'red' : 'green'}>
                              {formatChange(evFirstLeg.unitCount, evFirstLeg.instrument)}
                            </Badge>
                          )}
                        </label>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between gap-3 px-5 py-4 border-t border-gray-100 dark:border-gray-800 shrink-0">
            <Dialog.Close render={<Button variant="outline">Cancel</Button>} />
            <Button
              onClick={handleAssign}
              disabled={!categoryId || submitting}
            >
              {submitting
                ? 'Assigning…'
                : `Assign to ${assignCount} transaction${assignCount === 1 ? '' : 's'}`}
            </Button>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
