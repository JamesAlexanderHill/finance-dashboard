import * as React from 'react'
import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { eq, and } from 'drizzle-orm'
import { db } from '~/db'
import {
  users,
  events,
  legs,
  lineItems,
  instruments,
  accounts,
  categories,
  eventRelations,
} from '~/db/schema'
import { formatCurrency } from '~/lib/format-currency'

// ─── Server functions ─────────────────────────────────────────────────────────

const getEventDetail = createServerFn({ method: 'GET' })
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
        parentRelations: { with: { childEvent: true } },
        childRelations: { with: { parentEvent: true } },
      },
    })

    if (!event) throw new Error('Event not found')

    const [account, userCategories] = await Promise.all([
      db.query.accounts.findFirst({ where: eq(accounts.id, event.accountId) }),
      db.select().from(categories).where(eq(categories.userId, user.id)),
    ])

    return { event, account, userCategories }
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
    // Delete existing line items for this leg, then re-insert
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

const unlinkRelation = createServerFn({ method: 'POST' })
  .inputValidator(
    (data: unknown) => data as { parentEventId: string; childEventId: string },
  )
  .handler(async ({ data }) => {
    await db
      .delete(eventRelations)
      .where(
        and(
          eq(eventRelations.parentEventId, data.parentEventId),
          eq(eventRelations.childEventId, data.childEventId),
        ),
      )
  })

// ─── Route ────────────────────────────────────────────────────────────────────

export const Route = createFileRoute('/events/$eventId')({
  loader: ({ params }) => getEventDetail({ data: { id: params.eventId } }),
  component: EventDetailPage,
})

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

// ─── Component ────────────────────────────────────────────────────────────────

function EventDetailPage() {
  const { event, account, userCategories } = Route.useLoaderData()
  const router = useRouter()
  const [expandedLegId, setExpandedLegId] = React.useState<string | null>(null)

  const isDeleted = !!event.deletedAt

  async function handleToggleDelete() {
    await softDeleteEvent({
      data: {
        id: event.id,
        deletedAt: isDeleted ? null : new Date().toISOString(),
      },
    })
    router.invalidate()
  }

  async function handleCategoryChange(legId: string, categoryId: string) {
    await updateLegCategory({ data: { legId, categoryId: categoryId || null } })
    router.invalidate()
  }

  async function handleUnlinkRelation(parentId: string, childId: string) {
    await unlinkRelation({ data: { parentEventId: parentId, childEventId: childId } })
    router.invalidate()
  }

  // Build a flat category name map for select options
  function buildCategoryLabel(catId: string): string {
    const parts: string[] = []
    let current = userCategories.find((c) => c.id === catId)
    while (current) {
      parts.unshift(current.name)
      current = userCategories.find((c) => c.id === current!.parentId)
    }
    return parts.join(' › ')
  }

  return (
    <div className="max-w-3xl">
      {/* Back */}
      <Link
        to="/events"
        className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 mb-4 inline-block"
      >
        ← Events
      </Link>

      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1
            className={[
              'text-xl font-semibold',
              isDeleted
                ? 'text-gray-400 dark:text-gray-600 line-through'
                : 'text-gray-900 dark:text-gray-100',
            ].join(' ')}
          >
            {event.description}
          </h1>
        </div>
        <button
          onClick={handleToggleDelete}
          className={[
            'px-3 py-1.5 text-sm font-medium rounded-md transition-colors',
            isDeleted
              ? 'bg-green-100 dark:bg-green-950 text-green-700 dark:text-green-300 hover:bg-green-200 dark:hover:bg-green-900'
              : 'bg-red-100 dark:bg-red-950 text-red-700 dark:text-red-300 hover:bg-red-200 dark:hover:bg-red-900',
          ].join(' ')}
        >
          {isDeleted ? 'Restore' : 'Delete'}
        </button>
      </div>

      {/* Metadata */}
      <div className="grid grid-cols-2 gap-3 mb-6 text-sm">
        <MetaRow label="Effective" value={formatDate(event.effectiveAt)} />
        <MetaRow label="Posted" value={formatDate(event.postedAt)} />
        {event.externalId && <MetaRow label="External ID" value={event.externalId} />}
        {event.dedupeKey && (
          <MetaRow label="Dedupe Key" value={<code className="text-xs break-all">{event.dedupeKey}</code>} />
        )}
      </div>

      {/* Legs */}
      <Section title="Legs">
        <div className="space-y-3">
          {event.legs.map((leg: any) => {
            const neg = leg.unitCount < BigInt(0)
            const abs = neg ? -leg.unitCount : leg.unitCount
            const isExpanded = expandedLegId === leg.id

            return (
              <div
                key={leg.id}
                className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden"
              >
                {/* Leg row */}
                <div className="flex items-center gap-3 px-4 py-3 bg-white dark:bg-gray-900">
                  <span
                    className={[
                      'text-sm font-medium tabular-nums flex-1',
                      neg ? 'text-red-600 dark:text-red-400' : 'text-green-700 dark:text-green-400',
                    ].join(' ')}
                  >
                    {neg ? '−' : '+'}
                    {formatCurrency(leg.unitCount, {
                      exponent: leg.instrument.exponent,
                      ticker: leg.instrument.ticker,
                    })}
                  </span>

                  {/* Category selector */}
                  <select
                    value={leg.categoryId ?? ''}
                    onChange={(e) => handleCategoryChange(leg.id, e.target.value)}
                    className="text-xs border border-gray-200 dark:border-gray-700 rounded px-2 py-1 bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-1 focus:ring-blue-500 max-w-[160px]"
                  >
                    <option value="">No category</option>
                    {userCategories.map((cat) => (
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
                    Line items ({leg.lineItems.length})
                    {isExpanded ? ' ▲' : ' ▼'}
                  </button>
                </div>

                {/* Line items */}
                {isExpanded && (
                  <LineItemEditor
                    leg={leg}
                    userCategories={userCategories}
                    buildCategoryLabel={buildCategoryLabel}
                    onSave={async (items) => {
                      await upsertLineItems({
                        data: { legId: leg.id, userId: leg.userId, items },
                      })
                      router.invalidate()
                    }}
                  />
                )}
              </div>
            )
          })}
        </div>
      </Section>

      {/* Related events */}
      {(event.parentRelations.length > 0 || event.childRelations.length > 0) && (
        <Section title="Related Events">
          <div className="space-y-2 text-sm">
            {event.parentRelations.map((rel: any) => (
              <div key={rel.childEventId} className="flex items-center gap-3">
                <span className="text-xs bg-gray-100 dark:bg-gray-800 px-2 py-0.5 rounded text-gray-600 dark:text-gray-400">
                  {rel.relationType}
                </span>
                <Link
                  to="/events/$eventId"
                  params={{ eventId: rel.childEventId }}
                  className="text-blue-600 dark:text-blue-400 hover:underline flex-1"
                >
                  {rel.childEvent?.description ?? rel.childEventId}
                </Link>
                <button
                  onClick={() => handleUnlinkRelation(event.id, rel.childEventId)}
                  className="text-xs text-red-500 hover:text-red-700"
                >
                  Unlink
                </button>
              </div>
            ))}
            {event.childRelations.map((rel: any) => (
              <div key={rel.parentEventId} className="flex items-center gap-3">
                <span className="text-xs bg-gray-100 dark:bg-gray-800 px-2 py-0.5 rounded text-gray-600 dark:text-gray-400">
                  {rel.relationType} (parent)
                </span>
                <Link
                  to="/events/$eventId"
                  params={{ eventId: rel.parentEventId }}
                  className="text-blue-600 dark:text-blue-400 hover:underline flex-1"
                >
                  {rel.parentEvent?.description ?? rel.parentEventId}
                </Link>
                <button
                  onClick={() => handleUnlinkRelation(rel.parentEventId, event.id)}
                  className="text-xs text-red-500 hover:text-red-700"
                >
                  Unlink
                </button>
              </div>
            ))}
          </div>
        </Section>
      )}
    </div>
  )
}

// ─── Small helpers ────────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-6">
      <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3">
        {title}
      </h2>
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
  amountMinor: string
  categoryId: string
  description: string
}

function LineItemEditor({
  leg,
  userCategories,
  buildCategoryLabel,
  onSave,
}: {
  leg: any
  userCategories: any[]
  buildCategoryLabel: (id: string) => string
  onSave: (items: LineItemDraft[]) => Promise<void>
}) {
  const [items, setItems] = React.useState<LineItemDraft[]>(() =>
    leg.lineItems.map((li: any) => ({
      id: li.id,
      amountMinor: li.amountMinor.toString(),
      categoryId: li.categoryId ?? '',
      description: li.description ?? '',
    })),
  )
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const legTotal = leg.unitCount as bigint
  const itemTotal = items.reduce((sum, item) => {
    try {
      return sum + BigInt(item.amountMinor || '0')
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
    setItems([...items, { amountMinor: '0', categoryId: '', description: '' }])
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
              value={item.amountMinor}
              onChange={(e) => updateItem(idx, 'amountMinor', e.target.value)}
              placeholder="Amount (minor)"
              className="w-28 text-xs border border-gray-200 dark:border-gray-600 rounded px-2 py-1 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
            <select
              value={item.categoryId}
              onChange={(e) => updateItem(idx, 'categoryId', e.target.value)}
              className="text-xs border border-gray-200 dark:border-gray-600 rounded px-2 py-1 bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-1 focus:ring-blue-500 flex-1 max-w-[160px]"
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
