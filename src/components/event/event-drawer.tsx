import * as React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createServerFn } from '@tanstack/react-start'
import { useRouter } from '@tanstack/react-router'
import { Popover } from '@base-ui/react/popover'
import { Plus, X } from 'lucide-react'
import { eq, and } from 'drizzle-orm'
import { db } from '~/db'
import { events, legs, lineItems, categories } from '~/db/schema'
import type { EventRelationType } from '~/db/schema'
import { checkpointService, rateService, getSession, relationService } from '~/db/services'
import { formatCurrency } from '~/lib/format-currency'
import cn from '~/lib/class-merge'
import Badge from '~/components/ui/badge'
import { CategorySelector } from '~/components/ui/category-selector'
import { EventLegBar } from '~/components/event/event-leg-bar'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '~/components/ui/drawer'

// ─── Server functions ─────────────────────────────────────────────────────────

const getEventDrawerData = createServerFn({ method: 'GET' })
  .inputValidator((data: unknown) => data as { id: string })
  .handler(async ({ data }) => {
    const session = await getSession()
    if (!session) throw new Error('No user')

    const event = await db.query.events.findFirst({
      where: and(eq(events.id, data.id), eq(events.workspaceId, session.workspace.id)),
      with: {
        legs: {
          with: {
            instrument: true,
            category: true,
            lineItems: { with: { category: true } },
          },
        },
      },
    })

    if (!event) throw new Error('Event not found')

    const userCategories = await db
      .select()
      .from(categories)
      .where(eq(categories.workspaceId, session.workspace.id))

    const relations = await relationService.listForEvent(session.ctx, data.id)

    return { event, userCategories, workspaceId: session.workspace.id, relations }
  })

const softDeleteEvent = createServerFn({ method: 'POST' })
  .inputValidator((data: unknown) => data as { id: string; deletedAt: string | null })
  .handler(async ({ data }) => {
    const session = await getSession()
    if (!session) throw new Error('No user')
    await db
      .update(events)
      .set({ deletedAt: data.deletedAt ? new Date(data.deletedAt) : null })
      .where(and(eq(events.id, data.id), eq(events.workspaceId, session.workspace.id)))

    const affectedLegs = await db
      .selectDistinct({ instrumentId: legs.instrumentId })
      .from(legs)
      .where(eq(legs.eventId, data.id))

    const ctx = session.ctx
    for (const { instrumentId } of affectedLegs) {
      await checkpointService.refresh(ctx, instrumentId)
      await rateService.refresh(ctx, instrumentId)
    }
  })

const updateLegCategory = createServerFn({ method: 'POST' })
  .inputValidator((data: unknown) => data as { legId: string; categoryId: string | null })
  .handler(async ({ data }) => {
    const session = await getSession()
    if (!session) throw new Error('No user')
    // Scope to the caller's workspace so one tenant can't edit another's legs.
    await db
      .update(legs)
      .set({ categoryId: data.categoryId })
      .where(and(eq(legs.id, data.legId), eq(legs.workspaceId, session.workspace.id)))
  })

const upsertLineItems = createServerFn({ method: 'POST' })
  .inputValidator(
    (data: unknown) =>
      data as {
        legId: string
        items: Array<{ id?: string; unitCount: string; categoryId: string | null; description: string }>
      },
  )
  .handler(async ({ data }) => {
    const session = await getSession()
    if (!session) throw new Error('No user')
    // Verify the leg belongs to the caller's workspace before mutating; stamp
    // new rows with the session workspace (never a caller-supplied id).
    const [leg] = await db
      .select({ id: legs.id })
      .from(legs)
      .where(and(eq(legs.id, data.legId), eq(legs.workspaceId, session.workspace.id)))
      .limit(1)
    if (!leg) throw new Error('Leg not found')

    await db.delete(lineItems).where(eq(lineItems.legId, data.legId))
    if (data.items.length > 0) {
      await db.insert(lineItems).values(
        data.items.map((item) => ({
          workspaceId: session.workspace.id,
          legId: data.legId,
          unitCount: BigInt(item.unitCount),
          categoryId: item.categoryId,
          description: item.description || null,
        })),
      )
    }
  })

const createRelation = createServerFn({ method: 'POST' })
  .inputValidator(
    (data: unknown) =>
      data as { parentEventId: string; childEventId: string; relationType: EventRelationType },
  )
  .handler(async ({ data }) => {
    const session = await getSession()
    if (!session) throw new Error('No user')
    await relationService.create(session.ctx, data)
  })

const deleteRelation = createServerFn({ method: 'POST' })
  .inputValidator((data: unknown) => data as { parentEventId: string; childEventId: string })
  .handler(async ({ data }) => {
    const session = await getSession()
    if (!session) throw new Error('No user')
    await relationService.delete(session.ctx, data)
  })

const searchEventsForRelation = createServerFn({ method: 'GET' })
  .inputValidator((data: unknown) => data as { query: string; excludeEventIds: string[] })
  .handler(async ({ data }) => {
    const session = await getSession()
    if (!session) throw new Error('No user')
    return relationService.searchCandidates(session.ctx, {
      query: data.query,
      excludeEventIds: data.excludeEventIds,
    })
  })

const suggestEventsForRelation = createServerFn({ method: 'GET' })
  .inputValidator(
    (data: unknown) =>
      data as { eventId: string; relationType: EventRelationType; excludeEventIds: string[] },
  )
  .handler(async ({ data }) => {
    const session = await getSession()
    if (!session) throw new Error('No user')
    return relationService.suggest(session.ctx, data)
  })

// ─── Types ────────────────────────────────────────────────────────────────────

interface EventDrawerProps {
  eventId: string | undefined
  onClose: () => void
  // Switch the drawer to another event. Supplied by the route that owns the
  // `viewEvent` search param so the navigation is correctly typed.
  onOpenRelated: (id: string) => void
}

// ─── Component ────────────────────────────────────────────────────────────────

export function EventDrawer({ eventId, onClose, onOpenRelated }: EventDrawerProps) {
  const queryClient = useQueryClient()
  const router = useRouter()
  const [expandedLegId, setExpandedLegId] = React.useState<string | null>(null)

  const { data, isLoading, error } = useQuery({
    queryKey: ['event-drawer', eventId],
    queryFn: () => getEventDrawerData({ data: { id: eventId! } }),
    enabled: !!eventId,
  })

  const isOpen = !!eventId

  async function handleToggleDelete() {
    if (!data?.event) return
    const isDeleted = !!data.event.deletedAt
    await softDeleteEvent({
      data: {
        id: data.event.id,
        deletedAt: isDeleted ? null : new Date().toISOString(),
      },
    })
    queryClient.invalidateQueries({ queryKey: ['event-drawer', eventId] })
  }

  async function handleCategoryChange(legId: string, categoryId: string | null) {
    await updateLegCategory({ data: { legId, categoryId } })
    queryClient.invalidateQueries({ queryKey: ['event-drawer', eventId] })
  }

  // Relations change spend/income analytics, so refresh both the drawer and the
  // route loaders that feed the dashboard / category charts.
  async function refreshAfterRelationChange() {
    await queryClient.invalidateQueries({ queryKey: ['event-drawer', eventId] })
    await router.invalidate()
  }

  async function handleLinkCandidate(candidate: any, relationType: EventRelationType) {
    if (!data?.event) return
    const pair = assignParentChild(data.event, candidate)
    await createRelation({ data: { ...pair, relationType } })
    await refreshAfterRelationChange()
  }

  async function handleRemoveRelation(pair: { parentEventId: string; childEventId: string }) {
    await deleteRelation({ data: pair })
    await refreshAfterRelationChange()
  }

  const relationRows = data?.event ? buildRelationRows(data.event, data.relations) : []
  const excludeIds = data?.event ? [data.event.id, ...relationRows.map((r) => r.other.id)] : []

  return (
    <Sheet open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-lg overflow-y-auto">
        {isLoading && (
          <div className="p-6 text-gray-500 dark:text-gray-400 text-sm">Loading...</div>
        )}

        {error && (
          <div className="p-6 text-red-600 dark:text-red-400 text-sm">
            {error instanceof Error ? error.message : 'Error loading event'}
          </div>
        )}

        {data?.event && (
          <>
            <SheetHeader>
              <SheetTitle
                className={
                  data.event.deletedAt
                    ? 'text-gray-400 dark:text-gray-600 line-through'
                    : undefined
                }
              >
                {data.event.description}
              </SheetTitle>
              <EventLegBar legs={data.event.legs} categories={data.userCategories} />
              <SheetDescription>
                {formatDate(data.event.effectiveAt)}
              </SheetDescription>
            </SheetHeader>

            <div className="px-4 pb-6 space-y-6">
              {/* Details */}
              <Section title="Details">
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <MetaRow label="Effective" value={formatDate(data.event.effectiveAt)} />
                  <MetaRow label="Posted" value={formatDate(data.event.postedAt)} />
                  {data.event.externalId && (
                    <MetaRow label="External ID" value={data.event.externalId} />
                  )}
                  {data.event.dedupeKey && (
                    <MetaRow
                      label="Dedupe Key"
                      value={<code className="text-xs break-all">{data.event.dedupeKey}</code>}
                    />
                  )}
                </div>
                <button
                  onClick={handleToggleDelete}
                  className={[
                    'mt-4 px-3 py-1.5 text-sm font-medium rounded-md transition-colors',
                    data.event.deletedAt
                      ? 'bg-green-100 dark:bg-green-950 text-green-700 dark:text-green-300 hover:bg-green-200 dark:hover:bg-green-900'
                      : 'bg-red-100 dark:bg-red-950 text-red-700 dark:text-red-300 hover:bg-red-200 dark:hover:bg-red-900',
                  ].join(' ')}
                >
                  {data.event.deletedAt ? 'Restore' : 'Delete'}
                </button>
              </Section>

              {/* Legs */}
              <Section title={`Legs (${data.event.legs.length})`}>
                <div className="space-y-3">
                  {data.event.legs.map((leg: any) => {
                    const neg = leg.unitCount < BigInt(0)
                    const isExpanded = expandedLegId === leg.id

                    return (
                      <div
                        key={leg.id}
                        className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden"
                      >
                        {/* Leg row */}
                        <div className="flex items-center gap-3 px-4 py-3 bg-white dark:bg-gray-900">
                          <Badge color='yellow' className="shrink-0">
                            {leg.instrument.ticker}
                          </Badge>
                          <span
                            className={[
                              'text-sm font-medium tabular-nums flex-1',
                              neg
                                ? 'text-red-600 dark:text-red-400'
                                : 'text-green-700 dark:text-green-400',
                            ].join(' ')}
                          >
                            {formatCurrency(leg.unitCount, {
                              exponent: leg.instrument.exponent,
                              ticker: leg.instrument.ticker,
                            })}
                          </span>

                          {/* Category selector */}
                          <CategorySelector
                            value={leg.categoryId ?? null}
                            onChange={(id) => handleCategoryChange(leg.id, id)}
                            categories={data.userCategories}
                          />

                          {/* Expand line items */}
                          <button
                            onClick={() => setExpandedLegId(isExpanded ? null : leg.id)}
                            className="text-xs text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 whitespace-nowrap"
                          >
                            Items ({leg.lineItems.length})
                            {isExpanded ? ' ▲' : ' ▼'}
                          </button>
                        </div>

                        {/* Line items */}
                        {isExpanded && (
                          <LineItemEditor
                            leg={leg}
                            userCategories={data.userCategories}
                            onSave={async (items) => {
                              await upsertLineItems({ data: { legId: leg.id, items } })
                              queryClient.invalidateQueries({ queryKey: ['event-drawer', eventId] })
                            }}
                          />
                        )}
                      </div>
                    )
                  })}
                </div>
              </Section>

              {/* Relations */}
              <Section title={`Relations (${relationRows.length})`}>
                <div className="space-y-2">
                  {relationRows.length === 0 && (
                    <p className="text-xs text-gray-400 dark:text-gray-500 italic">
                      No linked transactions yet.
                    </p>
                  )}
                  {relationRows.map((row) => (
                    <div
                      key={row.key}
                      className="flex items-center gap-2 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2"
                    >
                      <button
                        onClick={() => onOpenRelated(row.other.id)}
                        className="flex-1 min-w-0 text-left outline-none"
                      >
                        <div className="flex items-center gap-2">
                          <Badge color="gray" className="shrink-0">
                            {relationLabel(row.type, row.anchorIsParent)}
                          </Badge>
                          <span className="text-sm text-gray-800 dark:text-gray-200 truncate">
                            {row.other.description}
                          </span>
                        </div>
                        <div className="mt-0.5 flex items-center gap-1.5 text-xs text-gray-400 dark:text-gray-500">
                          <span className="truncate">{row.other.account.name}</span>
                          <span>·</span>
                          <span className="whitespace-nowrap">{formatDate(row.other.effectiveAt)}</span>
                          <span>·</span>
                          <span className="tabular-nums whitespace-nowrap">
                            {formatEventNet(row.other)}
                          </span>
                        </div>
                      </button>
                      <button
                        onClick={() => handleRemoveRelation(row.pair)}
                        aria-label="Remove relation"
                        className="shrink-0 text-gray-400 hover:text-red-600 dark:hover:text-red-400 transition-colors"
                      >
                        <X className="size-4" />
                      </button>
                    </div>
                  ))}
                </div>
                {data.event && (
                  <RelationPicker
                    anchor={data.event}
                    excludeIds={excludeIds}
                    onLink={handleLinkCandidate}
                  />
                )}
              </Section>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(d: Date | string) {
  return new Date(d).toLocaleDateString('en-AU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3">
        {title}
      </h3>
      {children}
    </div>
  )
}

function MetaRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs text-gray-400 dark:text-gray-500 mb-0.5">{label}</p>
      <p className="text-sm text-gray-800 dark:text-gray-200">{value}</p>
    </div>
  )
}

// ─── LineItemEditor ───────────────────────────────────────────────────────────

type LineItemDraft = {
  id?: string
  unitCount: string
  categoryId: string
  description: string
}

function LineItemEditor({
  leg,
  userCategories,
  onSave,
}: {
  leg: any
  userCategories: any[]
  buildCategoryLabel?: (id: string) => string
  onSave: (items: LineItemDraft[]) => Promise<void>
}) {
  const [items, setItems] = React.useState<LineItemDraft[]>(() =>
    leg.lineItems.map((li: any) => ({
      id: li.id,
      unitCount: li.unitCount.toString(),
      categoryId: li.categoryId ?? '',
      description: li.description ?? '',
    })),
  )
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const legTotal = leg.unitCount as bigint
  const itemTotal = items.reduce((sum, item) => {
    try {
      return sum + BigInt(item.unitCount || '0')
    } catch {
      return sum
    }
  }, BigInt(0))
  const balanced = items.length === 0 || itemTotal === legTotal

  async function handleSave() {
    if (!balanced) {
      setError(`Line items sum (${itemTotal}) must equal leg amount (${legTotal})`)
      return
    }
    setSaving(true)
    setError(null)
    try {
      await onSave(items)
    } finally {
      setSaving(false)
    }
  }

  function addItem() {
    setItems([...items, { unitCount: '0', categoryId: '', description: '' }])
  }

  function removeItem(idx: number) {
    setItems(items.filter((_, i) => i !== idx))
  }

  function updateItem(idx: number, field: keyof LineItemDraft, value: string) {
    setItems(items.map((item, i) => (i === idx ? { ...item, [field]: value } : item)))
  }

  return (
    <div className="px-4 py-3 bg-gray-50 dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700">
      <div className="space-y-2 mb-3">
        {items.map((item, idx) => (
          <div key={idx} className="flex items-center gap-2">
            <input
              type="number"
              value={item.unitCount}
              onChange={(e) => updateItem(idx, 'unitCount', e.target.value)}
              placeholder="Amount"
              className="w-24 text-xs border border-gray-200 dark:border-gray-600 rounded px-2 py-1 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
            <CategorySelector
              value={item.categoryId || null}
              onChange={(id) => updateItem(idx, 'categoryId', id ?? '')}
              categories={userCategories}
            />
            <input
              type="text"
              value={item.description}
              onChange={(e) => updateItem(idx, 'description', e.target.value)}
              placeholder="Description"
              className="flex-1 text-xs border border-gray-200 dark:border-gray-600 rounded px-2 py-1 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
            <button
              onClick={() => removeItem(idx)}
              className="text-xs text-red-500 hover:text-red-700"
            >
              ✕
            </button>
          </div>
        ))}
      </div>

      {error && <p className="text-xs text-red-600 dark:text-red-400 mb-2">{error}</p>}
      {!balanced && !error && (
        <p className="text-xs text-orange-600 dark:text-orange-400 mb-2">
          Sum {itemTotal.toString()} ≠ leg {legTotal.toString()}
        </p>
      )}

      <div className="flex gap-2">
        <button
          onClick={addItem}
          className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
        >
          + Add line item
        </button>
        <button
          onClick={handleSave}
          disabled={saving || !balanced}
          className="text-xs px-2 py-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  )
}

// ─── Relations ────────────────────────────────────────────────────────────────

const RELATION_TYPES: EventRelationType[] = ['transfer', 'reimbursement', 'refund']

type RelationRow = {
  key: string
  pair: { parentEventId: string; childEventId: string }
  type: EventRelationType
  anchorIsParent: boolean
  other: any
}

// Flatten the two relation directions into display rows. `parentRelations` are
// relations where the open event is the parent (the other event is the child);
// `childRelations` are the reverse.
function buildRelationRows(event: any, relations: any): RelationRow[] {
  const rows: RelationRow[] = []
  for (const r of relations?.parentRelations ?? []) {
    rows.push({
      key: `${event.id}:${r.childEvent.id}`,
      pair: { parentEventId: event.id, childEventId: r.childEvent.id },
      type: r.relationType,
      anchorIsParent: true,
      other: r.childEvent,
    })
  }
  for (const r of relations?.childRelations ?? []) {
    rows.push({
      key: `${r.parentEvent.id}:${event.id}`,
      pair: { parentEventId: r.parentEvent.id, childEventId: event.id },
      type: r.relationType,
      anchorIsParent: false,
      other: r.parentEvent,
    })
  }
  return rows
}

function relationLabel(type: EventRelationType, anchorIsParent: boolean): string {
  switch (type) {
    case 'transfer':
      return anchorIsParent ? 'Transfer to' : 'Transfer from'
    case 'reimbursement':
      return anchorIsParent ? 'Reimbursed by' : 'Reimbursement for'
    case 'refund':
      return anchorIsParent ? 'Refunded by' : 'Refund of'
  }
}

function netUnitCount(legs: any[]): bigint {
  return legs.reduce((sum: bigint, l: any) => sum + BigInt(l.unitCount), BigInt(0))
}

// Net amount in the event's primary instrument, for compact display.
function formatEventNet(ev: any): string {
  if (!ev.legs?.length) return ''
  const inst = ev.legs[0].instrument
  const net = ev.legs
    .filter((l: any) => l.instrumentId === inst.id)
    .reduce((sum: bigint, l: any) => sum + BigInt(l.unitCount), BigInt(0))
  return formatCurrency(net, { exponent: inst.exponent, ticker: inst.ticker })
}

// Convention: parent = the outflow (negative net), child = the inflow (positive).
// This keeps reimbursement/refund netting correct (the inflow offsets the
// expense). Same-sign or ambiguous pairs keep the open event as the parent.
function assignParentChild(
  anchor: any,
  candidate: any,
): { parentEventId: string; childEventId: string } {
  const anchorNet = netUnitCount(anchor.legs)
  const candNet = netUnitCount(candidate.legs)
  if (anchorNet < BigInt(0) && candNet >= BigInt(0)) {
    return { parentEventId: anchor.id, childEventId: candidate.id }
  }
  if (candNet < BigInt(0) && anchorNet >= BigInt(0)) {
    return { parentEventId: candidate.id, childEventId: anchor.id }
  }
  return { parentEventId: anchor.id, childEventId: candidate.id }
}

// ─── RelationPicker ───────────────────────────────────────────────────────────

function RelationPicker({
  anchor,
  excludeIds,
  onLink,
}: {
  anchor: any
  excludeIds: string[]
  onLink: (candidate: any, relationType: EventRelationType) => Promise<void>
}) {
  const [open, setOpen] = React.useState(false)
  const [relationType, setRelationType] = React.useState<EventRelationType>('transfer')
  const [query, setQuery] = React.useState('')
  const [linking, setLinking] = React.useState(false)

  // An empty box shows type-specific suggestions; typing switches to free search.
  const showingSuggestions = query.trim().length === 0

  const { data: suggestions, isFetching: suggestFetching } = useQuery({
    queryKey: ['relation-suggest', anchor.id, relationType, excludeIds],
    queryFn: () =>
      suggestEventsForRelation({
        data: { eventId: anchor.id, relationType, excludeEventIds: excludeIds },
      }),
    enabled: open && showingSuggestions,
  })

  const { data: results, isFetching: searchFetching } = useQuery({
    queryKey: ['relation-search', anchor.id, query, excludeIds],
    queryFn: () => searchEventsForRelation({ data: { query, excludeEventIds: excludeIds } }),
    enabled: open && !showingSuggestions,
  })

  const list = showingSuggestions ? suggestions : results
  const fetching = showingSuggestions ? suggestFetching : searchFetching

  async function handlePick(candidate: any) {
    setLinking(true)
    try {
      await onLink(candidate, relationType)
      setOpen(false)
      setQuery('')
    } finally {
      setLinking(false)
    }
  }

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger className="mt-3 inline-flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400 hover:underline outline-none">
        <Plus className="size-3" />
        Link transaction
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner sideOffset={6} align="start" className="z-50">
          <Popover.Popup className="w-80 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg shadow-lg overflow-hidden">
            {/* Relation type */}
            <div className="flex gap-1 p-2 border-b border-gray-100 dark:border-gray-800">
              {RELATION_TYPES.map((t) => (
                <button
                  key={t}
                  onClick={() => setRelationType(t)}
                  className={cn(
                    'flex-1 capitalize text-xs rounded px-2 py-1 transition-colors',
                    relationType === t
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700',
                  )}
                >
                  {t}
                </button>
              ))}
            </div>

            {/* Search */}
            <div className="p-2">
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search description or amount…"
                className="w-full text-sm border border-gray-200 dark:border-gray-700 rounded px-2 py-1.5 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>

            {/* Suggested header (only when browsing suggestions) */}
            {showingSuggestions && (list?.length ?? 0) > 0 && (
              <div className="px-3 pt-2 text-[10px] font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">
                Suggested
              </div>
            )}

            {/* Results */}
            <ul className="max-h-64 overflow-y-auto pb-1">
              {fetching && (
                <li className="px-3 py-2 text-xs text-gray-400 dark:text-gray-500">
                  {showingSuggestions ? 'Finding suggestions…' : 'Searching…'}
                </li>
              )}
              {!fetching && (list?.length ?? 0) === 0 && (
                <li className="px-3 py-2 text-xs text-gray-400 dark:text-gray-500">
                  {showingSuggestions ? 'No suggestions — type to search' : 'No matching transactions'}
                </li>
              )}
              {list?.map((ev: any) => (
                <li key={ev.id}>
                  <button
                    disabled={linking}
                    onClick={() => handlePick(ev)}
                    className="w-full text-left px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors disabled:opacity-50 outline-none"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm text-gray-800 dark:text-gray-200 truncate">
                        {ev.description}
                      </span>
                      <span className="text-xs tabular-nums shrink-0 text-gray-500 dark:text-gray-400">
                        {formatEventNet(ev)}
                      </span>
                    </div>
                    <div className="text-xs text-gray-400 dark:text-gray-500">
                      {ev.account.name} · {formatDate(ev.effectiveAt)}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  )
}
