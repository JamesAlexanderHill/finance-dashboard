import {
  pgTable,
  pgEnum,
  text,
  integer,
  boolean,
  timestamp,
  primaryKey,
} from 'drizzle-orm/pg-core'
import { relations } from 'drizzle-orm'
import { uuidv7 } from 'uuidv7'

// ─── Helpers ──────────────────────────────────────────────────────────────────

const id = () => text('id').primaryKey().$defaultFn(() => uuidv7())
const createdAt = () =>
  timestamp('created_at', { withTimezone: true }).notNull().defaultNow()

// ─── Enums ────────────────────────────────────────────────────────────────────

export const workspaceMemberRoleEnum = pgEnum('workspace_member_role', ['owner', 'member'])

// ─── Users ────────────────────────────────────────────────────────────────────

export const users = pgTable('users', {
  id: id(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  homeCurrencyCode: text('home_currency_code').notNull().default('AUD'),
  emailVerified: boolean('email_verified').notNull().default(false),
  image: text('image'),
  createdAt: createdAt(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

// ─── Auth (Better Auth) ───────────────────────────────────────────────────────

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

// ─── Type exports ─────────────────────────────────────────────────────────────

export type User = typeof users.$inferSelect
export type AuthSession = typeof sessions.$inferSelect
export type AuthAccount = typeof authAccounts.$inferSelect
export type Verification = typeof verifications.$inferSelect
export type Passkey = typeof passkeys.$inferSelect
export type Workspace = typeof workspaces.$inferSelect
export type WorkspaceMember = typeof workspaceMembers.$inferSelect
export type WorkspaceMemberRole = (typeof workspaceMemberRoleEnum.enumValues)[number]
