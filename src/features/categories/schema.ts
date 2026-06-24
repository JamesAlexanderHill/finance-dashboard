import { pgTable, text } from 'drizzle-orm/pg-core'
import { relations } from 'drizzle-orm'
import type { AnyPgColumn } from 'drizzle-orm/pg-core'
import { uuidv7 } from 'uuidv7'
import { workspaces } from '~/features/core/schema'

const id = () => text('id').primaryKey().$defaultFn(() => uuidv7())
const workspaceId = () => text('workspace_id').notNull()

// ─── Categories ───────────────────────────────────────────────────────────────

export const categories = pgTable('categories', {
  id: id(),
  workspaceId: workspaceId().references(() => workspaces.id),
  parentId: text('parent_id').references((): AnyPgColumn => categories.id),
  name: text('name').notNull(),
})

// ─── Relations ────────────────────────────────────────────────────────────────

export const categoriesRelations = relations(categories, ({ one, many }) => ({
  parent: one(categories, {
    fields: [categories.parentId],
    references: [categories.id],
    relationName: 'categoryChildren',
  }),
  children: many(categories, { relationName: 'categoryChildren' }),
  workspace: one(workspaces, { fields: [categories.workspaceId], references: [workspaces.id] }),
}))

// ─── Type exports ─────────────────────────────────────────────────────────────

export type Category = typeof categories.$inferSelect
