import {
  pgTable,
  pgEnum,
  uuid,
  text,
  integer,
  bigint,
  boolean,
  timestamp,
  jsonb,
  unique,
} from "drizzle-orm/pg-core";
import type { AnyPgColumn } from "drizzle-orm/pg-core";

// ─── Enums ────────────────────────────────────────────────────────────────────

export const eventTypeEnum = pgEnum("event_type", [
  "purchase",
  "transfer",
  "exchange",
  "trade",
  "bill_payment",
  "payout",
]);

export const instrumentKindEnum = pgEnum("instrument_kind", [
  "fiat",
  "security",
  "crypto",
  "other",
]);

// ─── Users ────────────────────────────────────────────────────────────────────

// Note: homeCurrencyInstrumentId has no FK constraint to avoid circular reference
// with instruments.userId. Application logic enforces validity.
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  // FK to instruments — stored without constraint to avoid circularity
  homeCurrencyInstrumentId: uuid("home_currency_instrument_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// ─── Profiles ─────────────────────────────────────────────────────────────────

export const profiles = pgTable("profiles", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id),
  name: text("name").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// ─── Instruments ──────────────────────────────────────────────────────────────

export const instruments = pgTable("instruments", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id),
  code: text("code").notNull(),
  kind: instrumentKindEnum("kind").notNull(),
  minorUnit: integer("minor_unit").notNull(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// ─── Accounts ─────────────────────────────────────────────────────────────────

export const accounts = pgTable("accounts", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id),
  profileId: uuid("profile_id")
    .notNull()
    .references(() => profiles.id),
  name: text("name").notNull(),
  importerKey: text("importer_key").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// ─── Categories ───────────────────────────────────────────────────────────────

export const categories = pgTable(
  "categories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    // Self-referential FK — uses lambda to satisfy forward-reference
    parentId: uuid("parent_id").references(
      (): AnyPgColumn => categories.id,
    ),
    name: text("name").notNull(),
    // Stored lowercase for case-insensitive uniqueness enforcement
    normalizedName: text("normalized_name").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    // Siblings under the same parent must have unique normalizedName
    unique("categories_parent_normalized_name").on(t.parentId, t.normalizedName),
  ],
);

// ─── Import Runs ──────────────────────────────────────────────────────────────

export const importRuns = pgTable("import_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id),
  accountId: uuid("account_id")
    .notNull()
    .references(() => accounts.id),
  filename: text("filename").notNull(),
  importInstrumentId: uuid("import_instrument_id")
    .notNull()
    .references(() => instruments.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  importedCount: integer("imported_count").notNull().default(0),
  skippedCount: integer("skipped_count").notNull().default(0),
  restoredCount: integer("restored_count").notNull().default(0),
  errorCount: integer("error_count").notNull().default(0),
  skippedKeys: jsonb("skipped_keys").notNull().default([]),
  errors: jsonb("errors").notNull().default([]),
  restoreDeletedChosen: boolean("restore_deleted_chosen")
    .notNull()
    .default(false),
});

// ─── Events ───────────────────────────────────────────────────────────────────

export const events = pgTable("events", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id),
  profileId: uuid("profile_id")
    .notNull()
    .references(() => profiles.id),
  // Source/debit account (primary account for this event)
  accountId: uuid("account_id")
    .notNull()
    .references(() => accounts.id),
  eventType: eventTypeEnum("event_type").notNull(),
  effectiveAt: timestamp("effective_at").notNull(),
  postedAt: timestamp("posted_at"),
  description: text("description").notNull(),
  externalId: text("external_id"),
  // Globally unique — prevents duplicate imports
  dedupeKey: text("dedupe_key").notNull().unique(),
  importRunId: uuid("import_run_id").references(() => importRuns.id),
  deletedAt: timestamp("deleted_at"),
  meta: jsonb("meta"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// ─── Legs ─────────────────────────────────────────────────────────────────────

export const legs = pgTable("legs", {
  id: uuid("id").primaryKey().defaultRandom(),
  eventId: uuid("event_id")
    .notNull()
    .references(() => events.id),
  accountId: uuid("account_id")
    .notNull()
    .references(() => accounts.id),
  instrumentId: uuid("instrument_id")
    .notNull()
    .references(() => instruments.id),
  // Signed: negative = outflow, positive = inflow
  amountMinor: bigint("amount_minor", { mode: "bigint" }).notNull(),
  categoryId: uuid("category_id").references((): AnyPgColumn => categories.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// ─── Line Items ───────────────────────────────────────────────────────────────

export const lineItems = pgTable("line_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  legId: uuid("leg_id")
    .notNull()
    .references(() => legs.id),
  amountMinor: bigint("amount_minor", { mode: "bigint" }).notNull(),
  categoryId: uuid("category_id").references((): AnyPgColumn => categories.id),
  description: text("description"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// ─── Event Relations ──────────────────────────────────────────────────────────

export const eventRelations = pgTable("event_relations", {
  parentEventId: uuid("parent_event_id")
    .notNull()
    .references(() => events.id),
  childEventId: uuid("child_event_id")
    .notNull()
    .references(() => events.id),
  // e.g. "transfer_pair", "bill_to_charge"
  relationType: text("relation_type").notNull(),
});

// ─── Type exports ─────────────────────────────────────────────────────────────

export type User = typeof users.$inferSelect;
export type Profile = typeof profiles.$inferSelect;
export type Instrument = typeof instruments.$inferSelect;
export type Account = typeof accounts.$inferSelect;
export type Category = typeof categories.$inferSelect;
export type ImportRun = typeof importRuns.$inferSelect;
export type Event = typeof events.$inferSelect;
export type Leg = typeof legs.$inferSelect;
export type LineItem = typeof lineItems.$inferSelect;
export type EventRelation = typeof eventRelations.$inferSelect;
