import {
  pgTable,
  pgEnum,
  text,
  integer,
  bigint,
  boolean,
  timestamp,
  jsonb,
  numeric,
  unique,
  primaryKey,
} from 'drizzle-orm/pg-core'
import { relations } from 'drizzle-orm'
import type { AnyPgColumn } from 'drizzle-orm/pg-core'
import { uuidv7 } from 'uuidv7'
import { ACCOUNT_COLORS } from '~/lib/chart-colors'
import type { RecurrenceRule } from '~/lib/timeline-annotations'
import { workspaces } from '~/features/core/schema'
import { categories } from '~/features/categories/schema'

// ─── Helpers ──────────────────────────────────────────────────────────────────

const id = () => text('id').primaryKey().$defaultFn(() => uuidv7())
const workspaceId = () => text('workspace_id').notNull()
const createdAt = () =>
  timestamp('created_at', { withTimezone: true }).notNull().defaultNow()

// ─── Enums ────────────────────────────────────────────────────────────────────

export const eventTypeEnum = pgEnum('event_type', [
  'purchase',
  'transfer',
  'exchange',
  'trade',
  'bill_payment',
  'payout',
])

export const rateSourceEnum = pgEnum('rate_source', ['transaction', 'manual'])

export const accountColorEnum = pgEnum('account_color', ACCOUNT_COLORS)

// ─── Accounts ─────────────────────────────────────────────────────────────────

export const accounts = pgTable('accounts', {
  id: id(),
  workspaceId: workspaceId().references(() => workspaces.id),
  name: text('name').notNull(),
  defaultInstrumentId: text('default_instrument_id').references((): AnyPgColumn => instruments.id),
  color: accountColorEnum('color'),
  createdAt: createdAt(),
})

// ─── Instruments ──────────────────────────────────────────────────────────────

export const instruments = pgTable('instruments', {
  id: id(),
  workspaceId: workspaceId().references(() => workspaces.id),
  accountId: text('account_id')
    .notNull()
    .references(() => accounts.id),
  name: text('name').notNull(),
  ticker: text('ticker').notNull(),
  exponent: integer('exponent').notNull(),
})

// ─── Import Files ─────────────────────────────────────────────────────────────

export const files = pgTable('files', {
  id: id(),
  workspaceId: workspaceId().references(() => workspaces.id),
  accountId: text('account_id')
    .notNull()
    .references(() => accounts.id),
  filename: text('filename').notNull(),
  createdAt: createdAt(),
  importedCount: integer('imported_count').notNull().default(0),
  skippedCount: integer('skipped_count').notNull().default(0),
  restoredCount: integer('restored_count').notNull().default(0),
  errorCount: integer('error_count').notNull().default(0),
  skippedKeys: jsonb('skipped_keys').$type<string[]>().notNull().default([]),
  errors: jsonb('errors')
    .$type<Array<{ line: number; message: string; phase: string }>>()
    .notNull()
    .default([]),
})

// ─── Events ───────────────────────────────────────────────────────────────────

export const events = pgTable('events', {
  id: id(),
  workspaceId: workspaceId().references(() => workspaces.id),
  accountId: text('account_id')
    .notNull()
    .references(() => accounts.id),
  effectiveAt: timestamp('effective_at', { withTimezone: true }).notNull(),
  postedAt: timestamp('posted_at', { withTimezone: true }).notNull(),
  description: text('description').notNull(),
  externalId: text('external_id'),
  dedupeKey: text('dedupe_key').notNull().unique(),
  fileId: text('file_id').references(() => files.id),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  createdAt: createdAt(),
})

// ─── Legs ─────────────────────────────────────────────────────────────────────

export const legs = pgTable('legs', {
  id: id(),
  workspaceId: workspaceId().references(() => workspaces.id),
  eventId: text('event_id')
    .notNull()
    .references(() => events.id),
  instrumentId: text('instrument_id')
    .notNull()
    .references(() => instruments.id),
  unitCount: bigint('unit_count', { mode: 'bigint' }).notNull(),
  // Soft reference to categories — no DB FK so categories feature can be toggled off
  categoryId: text('category_id'),
  description: text('description'),
  createdAt: createdAt(),
})

// ─── Line Items ───────────────────────────────────────────────────────────────

export const lineItems = pgTable('line_items', {
  id: id(),
  workspaceId: workspaceId().references(() => workspaces.id),
  legId: text('leg_id')
    .notNull()
    .references(() => legs.id),
  unitCount: bigint('unit_count', { mode: 'bigint' }).notNull(),
  // Soft reference to categories — no DB FK so categories feature can be toggled off
  categoryId: text('category_id'),
  description: text('description'),
})

// ─── Instrument Checkpoints ───────────────────────────────────────────────────

export const instrumentCheckpoints = pgTable(
  'instrument_checkpoints',
  {
    id: id(),
    workspaceId: workspaceId().references(() => workspaces.id),
    instrumentId: text('instrument_id')
      .notNull()
      .references(() => instruments.id),
    periodEnd: timestamp('period_end', { withTimezone: true }).notNull(),
    balance: bigint('balance', { mode: 'bigint' }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [unique().on(t.instrumentId, t.periodEnd)],
)

// ─── Instrument Rates ─────────────────────────────────────────────────────────

export const instrumentRates = pgTable(
  'instrument_rates',
  {
    id: id(),
    workspaceId: workspaceId().references(() => workspaces.id),
    instrumentId: text('instrument_id')
      .notNull()
      .references(() => instruments.id),
    rate: numeric('rate', { precision: 20, scale: 8, mode: 'number' }).notNull(),
    asOf: timestamp('as_of', { withTimezone: true }).notNull(),
    source: rateSourceEnum('source').notNull(),
    createdAt: createdAt(),
  },
  (t) => [unique().on(t.instrumentId, t.source)],
)

// ─── Timeline Annotations ─────────────────────────────────────────────────────

export const timelineAnnotations = pgTable('timeline_annotations', {
  id: id(),
  workspaceId: workspaceId().references(() => workspaces.id),
  accountId: text('account_id')
    .notNull()
    .references(() => accounts.id),
  label: text('label').notNull(),
  date: timestamp('date', { withTimezone: true }).notNull(),
  endDate: timestamp('end_date', { withTimezone: true }),
  recurrence: jsonb('recurrence').$type<RecurrenceRule | null>().default(null),
  color: text('color'),
  createdAt: createdAt(),
})

// ─── Event Relations ──────────────────────────────────────────────────────────

export const eventRelations = pgTable(
  'event_relations',
  {
    parentEventId: text('parent_event_id')
      .notNull()
      .references(() => events.id),
    childEventId: text('child_event_id')
      .notNull()
      .references(() => events.id),
    relationType: text('relation_type').notNull(),
  },
  (t) => [primaryKey({ columns: [t.parentEventId, t.childEventId] })],
)

// ─── Relations ────────────────────────────────────────────────────────────────

export const accountsRelations = relations(accounts, ({ one, many }) => ({
  instruments: many(instruments, { relationName: 'accountInstruments' }),
  annotations: many(timelineAnnotations),
  defaultInstrument: one(instruments, {
    fields: [accounts.defaultInstrumentId],
    references: [instruments.id],
    relationName: 'defaultInstrument',
  }),
  workspace: one(workspaces, { fields: [accounts.workspaceId], references: [workspaces.id] }),
}))

export const instrumentsRelations = relations(instruments, ({ one, many }) => ({
  account: one(accounts, {
    fields: [instruments.accountId],
    references: [accounts.id],
    relationName: 'accountInstruments',
  }),
  defaultForAccounts: many(accounts, { relationName: 'defaultInstrument' }),
  workspace: one(workspaces, { fields: [instruments.workspaceId], references: [workspaces.id] }),
  checkpoints: many(instrumentCheckpoints),
  rates: many(instrumentRates),
}))

export const instrumentCheckpointsRelations = relations(instrumentCheckpoints, ({ one }) => ({
  instrument: one(instruments, {
    fields: [instrumentCheckpoints.instrumentId],
    references: [instruments.id],
  }),
}))

export const instrumentRatesRelations = relations(instrumentRates, ({ one }) => ({
  instrument: one(instruments, {
    fields: [instrumentRates.instrumentId],
    references: [instruments.id],
  }),
}))

export const eventsRelations = relations(events, ({ one, many }) => ({
  legs: many(legs),
  account: one(accounts, { fields: [events.accountId], references: [accounts.id] }),
  parentRelations: many(eventRelations, { relationName: 'parentEvent' }),
  childRelations: many(eventRelations, { relationName: 'childEvent' }),
}))

export const legsRelations = relations(legs, ({ one, many }) => ({
  event: one(events, { fields: [legs.eventId], references: [events.id] }),
  instrument: one(instruments, { fields: [legs.instrumentId], references: [instruments.id] }),
  // Soft cross-feature relation: categories feature may be disabled; no DB FK
  category: one(categories, { fields: [legs.categoryId], references: [categories.id] }),
  lineItems: many(lineItems),
}))

export const lineItemsRelations = relations(lineItems, ({ one }) => ({
  leg: one(legs, { fields: [lineItems.legId], references: [legs.id] }),
  // Soft cross-feature relation: categories feature may be disabled; no DB FK
  category: one(categories, { fields: [lineItems.categoryId], references: [categories.id] }),
}))

export const timelineAnnotationsRelations = relations(timelineAnnotations, ({ one }) => ({
  account: one(accounts, {
    fields: [timelineAnnotations.accountId],
    references: [accounts.id],
  }),
  workspace: one(workspaces, {
    fields: [timelineAnnotations.workspaceId],
    references: [workspaces.id],
  }),
}))

export const eventRelationRelations = relations(eventRelations, ({ one }) => ({
  parentEvent: one(events, {
    fields: [eventRelations.parentEventId],
    references: [events.id],
    relationName: 'parentEvent',
  }),
  childEvent: one(events, {
    fields: [eventRelations.childEventId],
    references: [events.id],
    relationName: 'childEvent',
  }),
}))

// ─── Type exports ─────────────────────────────────────────────────────────────

export type Account = typeof accounts.$inferSelect
export type Instrument = typeof instruments.$inferSelect
export type File = typeof files.$inferSelect
export type Event = typeof events.$inferSelect
export type Leg = typeof legs.$inferSelect
export type InstrumentCheckpoint = typeof instrumentCheckpoints.$inferSelect
export type InstrumentRate = typeof instrumentRates.$inferSelect
export type RateSource = (typeof rateSourceEnum.enumValues)[number]
export type LineItem = typeof lineItems.$inferSelect
export type EventRelation = typeof eventRelations.$inferSelect
export type TimelineAnnotation = typeof timelineAnnotations.$inferSelect
