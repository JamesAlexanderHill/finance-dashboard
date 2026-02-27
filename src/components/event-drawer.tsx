import * as React from 'react'
import { useRouter } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createServerFn } from '@tanstack/react-start'
import { eq, and } from 'drizzle-orm'
import { db } from '~/db'
import { users, events, legs, lineItems, categories } from '~/db/schema'
import { formatCurrency } from '~/lib/format-currency'
import Badge from '~/components/atom/badge'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '~/components/drawer'

// ─── Server functions ─────────────────────────────────────────────────────────

const getEventDrawerData = createServerFn({ method: 'GET' })
  .inputValidator((data: unknown) => data as { id: string })
  .handler(async ({ data }) => {
    const [user] = await db.select().from(users).limit(1)
    if (!user) throw new Error('No user')

    const event = await db.query.events.findFirst({
      where: and(eq(events.id, data.id), eq(events.userId, user.id)),
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
      .where(eq(categories.userId, user.id))

    return { event, userCategories, userId: user.id }
  })

const softDeleteEvent = createServerFn({ method: 'POST' })
  .inputValidator((data: unknown) => data as { id: string; deletedAt: string | null })
  .handler(async ({ data }) => {
    const [user] = await db.select().from(users).limit(1)
    if (!user) throw new Error('No user')
    await db
      .update(events)
      .set({ deletedAt: data.deletedAt ? new Date(data.deletedAt) : null })
      .where(and(eq(events.id, data.id), eq(events.userId, user.id)))
  })

const updateLegCategory = createServerFn({ method: 'POST' })
  .inputValidator((data: unknown) => data as { legId: string; categoryId: string | null })
  .handler(async ({ data }) => {
    await db
      .update(legs)
      .set({ categoryId: data.categoryId })
      .where(eq(legs.id, data.legId))
  })

const upsertLineItems = createServerFn({ method: 'POST' })
  .inputValidator(
    (data: unknown) =>
      data as {
        legId: string
        userId: string
        items: Array<{ id?: string; unitCount: string; categoryId: string | null; description: string }>
      },
  )
  .handler(async ({ data }) => {
    await db.delete(lineItems).where(eq(lineItems.legId, data.legId))
    if (data.items.length > 0) {
      await db.insert(lineItems).values(
        data.items.map((item) => ({
          userId: data.userId,
          legId: data.legId,
          unitCount: BigInt(item.unitCount),
          categoryId: item.categoryId,
          description: item.description || null,
        })),
      )
    }
  })

// ─── Types ────────────────────────────────────────────────────────────────────

interface EventDrawerProps {
  eventId: string | undefined
  onClose: () => void
}

// ─── Component ────────────────────────────────────────────────────────────────

export function EventDrawer({ eventId, onClose }: EventDrawerProps) {
  const queryClient = useQueryClient()
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

  async function handleCategoryChange(legId: string, categoryId: string) {
    await updateLegCategory({ data: { legId, categoryId: categoryId || null } })
    queryClient.invalidateQueries({ queryKey: ['event-drawer', eventId] })
  }

  function buildCategoryLabel(catId: string): string {
    if (!data?.userCategories) return ''
    const parts: string[] = []
    let current = data.userCategories.find((c) => c.id === catId)
    while (current) {
      parts.unshift(current.name)
      current = data.userCategories.find((c) => c.id === current!.parentId)
    }
    return parts.join(' › ')
  }

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
                          <Badge variant="secondary" className="shrink-0">
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
                          <select
                            value={leg.categoryId ?? ''}
                            onChange={(e) => handleCategoryChange(leg.id, e.target.value)}
                            className="text-xs border border-gray-200 dark:border-gray-700 rounded px-2 py-1 bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-1 focus:ring-blue-500 max-w-[120px]"
                          >
                            <option value="">No category</option>
                            {data.userCategories.map((cat) => (
                              <option key={cat.id} value={cat.id}>
                                {buildCategoryLabel(cat.id)}
                              </option>
                            ))}
                          </select>

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
                            userId={data.userId}
                            userCategories={data.userCategories}
                            buildCategoryLabel={buildCategoryLabel}
                            onSave={async (items) => {
                              await upsertLineItems({
                                data: { legId: leg.id, userId: data.userId, items },
                              })
                              queryClient.invalidateQueries({ queryKey: ['event-drawer', eventId] })
                            }}
                          />
                        )}
                      </div>
                    )
                  })}
                </div>
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
  userId,
  userCategories,
  buildCategoryLabel,
  onSave,
}: {
  leg: any
  userId: string
  userCategories: any[]
  buildCategoryLabel: (id: string) => string
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
            <select
              value={item.categoryId}
              onChange={(e) => updateItem(idx, 'categoryId', e.target.value)}
              className="text-xs border border-gray-200 dark:border-gray-600 rounded px-2 py-1 bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-1 focus:ring-blue-500 flex-1 max-w-[120px]"
            >
              <option value="">No category</option>
              {userCategories.map((cat) => (
                <option key={cat.id} value={cat.id}>
                  {buildCategoryLabel(cat.id)}
                </option>
              ))}
            </select>
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
