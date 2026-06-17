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

export const workspaceMemberRoleEnum = pgEnum('workspace_member_role', ['owner', 'member'])

// ─── Users ────────────────────────────────────────────────────────────────────

export const users = pgTable('users', {
  id: id(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  // Currency used to display converted balances (e.g. net worth). Each user
  // sets their own preference; not a workspace-level setting.
  homeCurrencyCode: text('home_currency_code').notNull().default('AUD'),
  // Managed by Better Auth. Property names must match Better Auth's `user`
  // model fields (emailVerified, image, createdAt, updatedAt).
  emailVerified: boolean('email_verified').notNull().default(false),
  image: text('image'),
  createdAt: createdAt(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

// ─── Auth (Better Auth) ───────────────────────────────────────────────────────
// These tables back Better Auth's core models. The `account` model is mapped to
// `auth_accounts` so it doesn't collide with the app's financial `accounts`
// table. Property names mirror Better Auth field names so the drizzle adapter
// can map them without extra field config.

export const sessions = pgTable('sessions', {
  id: id(),
  token: text('token').notNull().unique(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  createdAt: createdAt(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const authAccounts = pgTable('auth_accounts', {
  id: id(),
  accountId: text('account_id').notNull(),
  providerId: text('provider_id').notNull(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  idToken: text('id_token'),
  accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }),
  refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { withTimezone: true }),
  scope: text('scope'),
  password: text('password'),
  createdAt: createdAt(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const verifications = pgTable('verifications', {
  id: id(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: createdAt(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

// WebAuthn passkeys (Better Auth passkey plugin). Property names mirror the
// plugin's field names (publicKey, credentialID, deviceType, backedUp, …).
export const passkeys = pgTable('passkeys', {
  id: id(),
  name: text('name'),
  publicKey: text('public_key').notNull(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  credentialID: text('credential_id').notNull(),
  counter: integer('counter').notNull(),
  deviceType: text('device_type').notNull(),
  backedUp: boolean('backed_up').notNull(),
  transports: text('transports'),
  aaguid: text('aaguid'),
  createdAt: createdAt(),
})

// ─── Workspaces ───────────────────────────────────────────────────────────────

export const workspaces = pgTable('workspaces', {
  id: id(),
  name: text('name').notNull(),
  isPersonal: boolean('is_personal').notNull().default(false),
  ownerId: text('owner_id').notNull().references(() => users.id),
  createdAt: createdAt(),
})

// ─── Workspace Members ────────────────────────────────────────────────────────

export const workspaceMembers = pgTable(
  'workspace_members',
  {
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    role: workspaceMemberRoleEnum('role').notNull().default('member'),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.workspaceId, t.userId] })],
)

// ─── Accounts ─────────────────────────────────────────────────────────────────

export const accounts = pgTable('accounts', {
  id: id(),
  workspaceId: workspaceId().references(() => workspaces.id),
  name: text('name').notNull(),
  defaultInstrumentId: text('default_instrument_id').references((): AnyPgColumn => instruments.id),
  // Base chart hue for this account's instruments. null = auto-assigned by account order.
  color: accountColorEnum('color'),
  createdAt: createdAt(),
})

// ─── Instruments (account-scoped) ─────────────────────────────────────────────

export const instruments = pgTable('instruments', {
  id: id(),
  workspaceId: workspaceId().references(() => workspaces.id),
  accountId: text('account_id')
    .notNull()
    .references(() => accounts.id),
  name: text('name').notNull(),
  ticker: text('ticker').notNull(), // e.g. "USD", "VHY"
  exponent: integer('exponent').notNull(), // Number of decimal places (e.g. 2 for USD)
});

// ─── Categories ───────────────────────────────────────────────────────────────

export const categories = pgTable('categories', {
  id: id(),
  workspaceId: workspaceId().references(() => workspaces.id),
  parentId: text('parent_id').references((): AnyPgColumn => categories.id),
  name: text('name').notNull(),
});

// ─── Import Runs ──────────────────────────────────────────────────────────────

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
});

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
  // Globally unique — prevents duplicate imports
  dedupeKey: text('dedupe_key').notNull().unique(),
  fileId: text('file_id').references(() => files.id),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  createdAt: createdAt(),
});

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
    workspaceId: workspaceId().references(() => workspaces.id),
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
// (users.homeCurrencyCode). Instruments whose ticker === homeCurrencyCode
// have no row (implicit rate = 1).
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

// ─── Line Items ───────────────────────────────────────────────────────────────

export const lineItems = pgTable('line_items', {
  id: id(),
  workspaceId: workspaceId().references(() => workspaces.id),
  legId: text('leg_id')
    .notNull()
    .references(() => legs.id),
  unitCount: bigint('unit_count', { mode: 'bigint' }).notNull(),
  categoryId: text('category_id').references((): AnyPgColumn => categories.id),
  description: text('description'),
})

// ─── Timeline Annotations ─────────────────────────────────────────────────────

export const timelineAnnotations = pgTable('timeline_annotations', {
  id: id(),
  workspaceId: workspaceId().references(() => workspaces.id),
  accountId: text('account_id')
    .notNull()
    .references(() => accounts.id),
  label: text('label').notNull(),
  // Anchor date. For one-time annotations this is the sole occurrence date.
  // For recurring annotations this is the reference point the cadence expands from.
  date: timestamp('date', { withTimezone: true }).notNull(),
  recurrence: jsonb('recurrence').$type<RecurrenceRule | null>().default(null),
  // Optional color name override (e.g. 'rose'). null = default amber.
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

export const usersRelations = relations(users, ({ many }) => ({
  workspaceMembers: many(workspaceMembers),
  ownedWorkspaces: many(workspaces, { relationName: 'workspaceOwner' }),
}))

export const workspacesRelations = relations(workspaces, ({ one, many }) => ({
  owner: one(users, {
    fields: [workspaces.ownerId],
    references: [users.id],
    relationName: 'workspaceOwner',
  }),
  members: many(workspaceMembers),
}))

export const workspaceMembersRelations = relations(workspaceMembers, ({ one }) => ({
  workspace: one(workspaces, { fields: [workspaceMembers.workspaceId], references: [workspaces.id] }),
  user: one(users, { fields: [workspaceMembers.userId], references: [users.id] }),
}))

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

export type User = typeof users.$inferSelect
export type AuthSession = typeof sessions.$inferSelect
export type AuthAccount = typeof authAccounts.$inferSelect
export type Verification = typeof verifications.$inferSelect
export type Passkey = typeof passkeys.$inferSelect
export type Workspace = typeof workspaces.$inferSelect
export type WorkspaceMember = typeof workspaceMembers.$inferSelect
export type WorkspaceMemberRole = (typeof workspaceMemberRoleEnum.enumValues)[number]
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
export type TimelineAnnotation = typeof timelineAnnotations.$inferSelect
