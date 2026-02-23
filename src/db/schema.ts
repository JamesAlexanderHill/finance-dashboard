import {
  pgTable,
  pgEnum,
  text,
  integer,
  bigint,
  boolean,
  timestamp,
  jsonb,
  unique,
  primaryKey,
} from 'drizzle-orm/pg-core'
import type { AnyPgColumn } from 'drizzle-orm/pg-core'
import { uuidv7 } from 'uuidv7'

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

export const instrumentKindEnum = pgEnum('instrument_kind', [
  'fiat',
  'security',
  'crypto',
  'other',
])

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
  importerKey: text('importer_key').notNull().default('canonical_csv_v1'),
  createdAt: createdAt(),
})

// ─── Instruments (account-scoped) ─────────────────────────────────────────────

export const instruments = pgTable('instruments', {
  id: id(),
  userId: userId().references(() => users.id),
  accountId: text('account_id')
    .notNull()
    .references(() => accounts.id),
  code: text('code').notNull(),
  kind: instrumentKindEnum('kind').notNull(),
  minorUnit: integer('minor_unit').notNull(),
  name: text('name').notNull(),
})

// ─── Views (segmentation tags) ────────────────────────────────────────────────

export const views = pgTable('views', {
  id: id(),
  userId: userId().references(() => users.id),
  name: text('name').notNull(),
  nameNormalized: text('name_normalized').notNull(),
})

// ─── Categories ───────────────────────────────────────────────────────────────

export const categories = pgTable(
  'categories',
  {
    id: id(),
    userId: userId().references(() => users.id),
    parentId: text('parent_id').references((): AnyPgColumn => categories.id),
    name: text('name').notNull(),
    nameNormalized: text('name_normalized').notNull(),
  },
  (t) => [
    unique('categories_parent_normalized').on(t.parentId, t.nameNormalized),
  ],
)

// ─── Import Runs ──────────────────────────────────────────────────────────────

export const importRuns = pgTable('import_runs', {
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
  restoreDeletedChosen: boolean('restore_deleted_chosen').notNull().default(false),
})

// ─── Events ───────────────────────────────────────────────────────────────────

export const events = pgTable('events', {
  id: id(),
  userId: userId().references(() => users.id),
  accountId: text('account_id')
    .notNull()
    .references(() => accounts.id),
  eventType: eventTypeEnum('event_type').notNull(),
  effectiveAt: timestamp('effective_at', { withTimezone: true }).notNull(),
  postedAt: timestamp('posted_at', { withTimezone: true }).notNull(),
  description: text('description').notNull(),
  externalId: text('external_id'),
  // Globally unique — prevents duplicate imports
  dedupeKey: text('dedupe_key').notNull().unique(),
  importRunId: text('import_run_id').references(() => importRuns.id),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  createdAt: createdAt(),
})

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
  amountMinor: bigint('amount_minor', { mode: 'bigint' }).notNull(),
  categoryId: text('category_id').references((): AnyPgColumn => categories.id),
  description: text('description'),
  createdAt: createdAt(),
})

// ─── Line Items ───────────────────────────────────────────────────────────────

export const lineItems = pgTable('line_items', {
  id: id(),
  userId: userId().references(() => users.id),
  legId: text('leg_id')
    .notNull()
    .references(() => legs.id),
  amountMinor: bigint('amount_minor', { mode: 'bigint' }).notNull(),
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

// ─── Type exports ─────────────────────────────────────────────────────────────

export type User = typeof users.$inferSelect
export type Account = typeof accounts.$inferSelect
export type Instrument = typeof instruments.$inferSelect
export type View = typeof views.$inferSelect
export type Category = typeof categories.$inferSelect
export type ImportRun = typeof importRuns.$inferSelect
export type Event = typeof events.$inferSelect
export type Leg = typeof legs.$inferSelect
export type LineItem = typeof lineItems.$inferSelect
export type EventRelation = typeof eventRelations.$inferSelect
