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
import { CHART_COLORS } from '~/lib/chart-colors'

// ─── Helpers ──────────────────────────────────────────────────────────────────

const id = () => text('id').primaryKey().$defaultFn(() => uuidv7())
const userId = () => text('user_id').notNull()
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

export const chartColorEnum = pgEnum('chart_color', CHART_COLORS)

// ─── Users ────────────────────────────────────────────────────────────────────

export const users = pgTable('users', {
  id: id(),
  name: text('name').notNull(),
  homeCurrencyCode: text('home_currency_code').notNull(),
  createdAt: createdAt(),
})

// ─── Accounts ─────────────────────────────────────────────────────────────────

export const accounts = pgTable('accounts', {
  id: id(),
  userId: userId().references(() => users.id),
  name: text('name').notNull(),
  defaultInstrumentId: text('default_instrument_id').references((): AnyPgColumn => instruments.id),
  createdAt: createdAt(),
})

// ─── Instruments (account-scoped) ─────────────────────────────────────────────

export const instruments = pgTable('instruments', {
  id: id(),
  userId: userId().references(() => users.id),
  accountId: text('account_id')
    .notNull()
    .references(() => accounts.id),
  name: text('name').notNull(),
  ticker: text('ticker').notNull(), // e.g. "USD", "VHY"
  exponent: integer('exponent').notNull(), // Number of decimal places (e.g. 2 for USD)
  // Chart line colors for the balance graph. null = auto-assigned.
  positiveColor: chartColorEnum('positive_color'),
  negativeColor: chartColorEnum('negative_color'),
  neutralColor: chartColorEnum('neutral_color'),
});

// ─── Categories ───────────────────────────────────────────────────────────────

export const categories = pgTable('categories', {
  id: id(),
  userId: userId().references(() => users.id),
  parentId: text('parent_id').references((): AnyPgColumn => categories.id),
  name: text('name').notNull(),
});

// ─── Import Runs ──────────────────────────────────────────────────────────────

export const files = pgTable('files', {
  id: id(),
  userId: userId().references(() => users.id),
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
});

// ─── Events ───────────────────────────────────────────────────────────────────

export const events = pgTable('events', {
  id: id(),
  userId: userId().references(() => users.id),
  accountId: text('account_id')
    .notNull()
    .references(() => accounts.id),
  effectiveAt: timestamp('effective_at', { withTimezone: true }).notNull(),
  postedAt: timestamp('posted_at', { withTimezone: true }).notNull(),
  description: text('description').notNull(),
  externalId: text('external_id'),
  // Globally unique — prevents duplicate imports
  dedupeKey: text('dedupe_key').notNull().unique(),
  fileId: text('file_id').references(() => files.id),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  createdAt: createdAt(),
});

// ─── Legs ─────────────────────────────────────────────────────────────────────

export const legs = pgTable('legs', {
  id: id(),
  userId: userId().references(() => users.id),
  eventId: text('event_id')
    .notNull()
    .references(() => events.id),
  instrumentId: text('instrument_id')
    .notNull()
    .references(() => instruments.id),
  // Signed: negative = outflow, positive = inflow
  unitCount: bigint('unit_count', { mode: 'bigint' }).notNull(),
  categoryId: text('category_id').references((): AnyPgColumn => categories.id),
  description: text('description'),
  createdAt: createdAt(),
})

// ─── Instrument Checkpoints ───────────────────────────────────────────────────

export const instrumentCheckpoints = pgTable(
  'instrument_checkpoints',
  {
    id: id(),
    userId: userId().references(() => users.id),
    instrumentId: text('instrument_id')
      .notNull()
      .references(() => instruments.id),
    // Exclusive upper bound: first instant of the month AFTER the checkpointed
    // month (UTC). balance covers all non-deleted legs with effectiveAt < periodEnd.
    periodEnd: timestamp('period_end', { withTimezone: true }).notNull(),
    balance: bigint('balance', { mode: 'bigint' }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [unique().on(t.instrumentId, t.periodEnd)],
)

// ─── Instrument Rates ─────────────────────────────────────────────────────────

// 1 unit of `instrumentId` = `rate` units of the user's home currency
// (users.homeCurrencyCode). Instruments whose ticker === homeCurrencyCode have
// no row (implicit rate = 1).
export const instrumentRates = pgTable(
  'instrument_rates',
  {
    id: id(),
    userId: userId().references(() => users.id),
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

// ─── Line Items ───────────────────────────────────────────────────────────────

export const lineItems = pgTable('line_items', {
  id: id(),
  userId: userId().references(() => users.id),
  legId: text('leg_id')
    .notNull()
    .references(() => legs.id),
  unitCount: bigint('unit_count', { mode: 'bigint' }).notNull(),
  categoryId: text('category_id').references((): AnyPgColumn => categories.id),
  description: text('description'),
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
export const accountsRelations = relations(accounts, ({ one, many }) => ({// account -> instruments (via instruments.accountId)
  instruments: many(instruments, { relationName: 'accountInstruments' }),

  defaultInstrument: one(instruments, {
    fields: [accounts.defaultInstrumentId],
    references: [instruments.id],
    relationName: 'defaultInstrument',
  }),

  user: one(users, { fields: [accounts.userId], references: [users.id] }),
}))

export const instrumentsRelations = relations(instruments, ({ one, many }) => ({
  // instruments.accountId -> accounts.id
  account: one(accounts, {
    fields: [instruments.accountId],
    references: [accounts.id],
    relationName: 'accountInstruments',
  }),

  // accounts.defaultInstrumentId -> instruments.id
  defaultForAccounts: many(accounts, {
    relationName: 'defaultInstrument',
  }),

  // optional but usually useful
  user: one(users, { fields: [instruments.userId], references: [users.id] }),

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
  // eventRelations where this event is the parent
  parentRelations: many(eventRelations, { relationName: 'parentEvent' }),
  // eventRelations where this event is the child
  childRelations: many(eventRelations, { relationName: 'childEvent' }),
}))

export const legsRelations = relations(legs, ({ one, many }) => ({
  event: one(events, { fields: [legs.eventId], references: [events.id] }),
  instrument: one(instruments, { fields: [legs.instrumentId], references: [instruments.id] }),
  category: one(categories, { fields: [legs.categoryId], references: [categories.id] }),
  lineItems: many(lineItems),
}))

export const lineItemsRelations = relations(lineItems, ({ one }) => ({
  leg: one(legs, { fields: [lineItems.legId], references: [legs.id] }),
  category: one(categories, { fields: [lineItems.categoryId], references: [categories.id] }),
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

export type User = typeof users.$inferSelect
export type Account = typeof accounts.$inferSelect
export type Instrument = typeof instruments.$inferSelect
// export type View = typeof views.$inferSelect
export type Category = typeof categories.$inferSelect
export type File = typeof files.$inferSelect
export type Event = typeof events.$inferSelect
export type Leg = typeof legs.$inferSelect
export type InstrumentCheckpoint = typeof instrumentCheckpoints.$inferSelect
export type InstrumentRate = typeof instrumentRates.$inferSelect
export type RateSource = (typeof rateSourceEnum.enumValues)[number]
export type LineItem = typeof lineItems.$inferSelect
export type EventRelation = typeof eventRelations.$inferSelect
