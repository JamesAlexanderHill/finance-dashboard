import { eq, and } from 'drizzle-orm'
import { db } from '~/db'
import {
  accounts,
  events,
  files,
  instruments,
  legs,
  categories,
} from '~/db/schema'
import type { Category } from '~/db/schema'
import { computeDedupeKey } from './dedupe'
import type { ParsedEvent } from '~/importers/canonical'

export interface InstrumentDraft {
  ticker: string
  name: string
  exponent: number
  /** If set, this is an existing instrument ID — no creation needed. */
  existingId?: string
}

export interface CommitImportParams {
  userId: string
  accountId: string
  filename: string
  events: ParsedEvent[]
  /** Instruments to create or reuse. Keyed by ticker (uppercase). */
  instrumentDrafts: InstrumentDraft[]
  /** Category assignments: eventGroup_legIndex → categoryPath */
  categoryAssignments: Record<string, string | null>
  restoreDeletedChosen: boolean
}

/** Resolve a category path (e.g. "food:coffee") to a category ID for a given user. */
async function resolveCategoryPath(
  userId: string,
  path: string,
  userCategories: Category[],
): Promise<string | null> {
  if (!path) return null
  const parts = path.toLowerCase().split(':')
  let parentId: string | null = null

  for (const part of parts) {
    const match = userCategories.find(
      (c) => c.name.toLowerCase() === part && c.parentId === parentId && c.userId === userId,
    )
    if (!match) return null
    parentId = match.id
  }
  return parentId
}

/**
 * Commit a staged import to the database.
 *
 * - Creates any new instruments listed in instrumentDrafts
 * - Inserts events+legs with dedupe logic
 * - Assigns categories from categoryAssignments
 * - Records a File with stats and returns its ID
 */
export async function commitImport(params: CommitImportParams): Promise<string> {
  const {
    userId,
    accountId,
    filename,
    restoreDeletedChosen,
  } = params

  // ── 1. Verify account ownership ────────────────────────────────────────────
  const [account] = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.id, accountId), eq(accounts.userId, userId)))

  if (!account) throw new Error(`Account not found: ${accountId}`)

  // ── 2. Create / resolve instruments ───────────────────────────────────────
  const instrumentMap = new Map<string, string>() // ticker.upper → id

  for (const draft of params.instrumentDrafts) {
    const ticker = draft.ticker.toUpperCase()
    if (draft.existingId) {
      instrumentMap.set(ticker, draft.existingId)
    } else {
      const [created] = await db
        .insert(instruments)
        .values({
          userId,
          accountId,
          ticker: draft.ticker,
          exponent: draft.exponent,
          name: draft.name,
        })
        .returning({ id: instruments.id })
      instrumentMap.set(ticker, created.id)
    }
  }

  // ── 3. Resolve categories for this user ───────────────────────────────────
  const userCategories = await db
    .select()
    .from(categories)
    .where(eq(categories.userId, userId))

  // ── 4. Process events ─────────────────────────────────────────────────────
  let importedCount = 0
  let skippedCount = 0
  let restoredCount = 0
  let errorCount = 0
  const skippedKeys: string[] = []
  const importErrors: Array<{ line: number; message: string; phase: string }> = []

  for (let evIdx = 0; evIdx < params.events.length; evIdx++) {
    const parsed = params.events[evIdx]
    const line = evIdx + 2 // approximate CSV line number

    try {
      const primaryUnitCount = parsed.legs[0]?.amountMinor ?? BigInt(0)
      const dedupeKey = computeDedupeKey({
        accountId,
        externalEventId: parsed.externalEventId,
        effectiveAt: parsed.effectiveAt,
        primaryAmountMinor: primaryUnitCount,
        description: parsed.description,
      })

      // Check for existing event
      const [existing] = await db
        .select({ id: events.id, deletedAt: events.deletedAt })
        .from(events)
        .where(eq(events.dedupeKey, dedupeKey))

      if (existing) {
        if (!existing.deletedAt) {
          skippedCount++
          skippedKeys.push(dedupeKey)
          continue
        }
        if (restoreDeletedChosen) {
          await db
            .update(events)
            .set({ deletedAt: null })
            .where(eq(events.id, existing.id))
          restoredCount++
        } else {
          skippedCount++
          skippedKeys.push(dedupeKey)
        }
        continue
      }

      // Insert event + legs in a transaction
      await db.transaction(async (tx) => {
        const [newEvent] = await tx
          .insert(events)
          .values({
            userId,
            accountId,
            effectiveAt: parsed.effectiveAt,
            postedAt: parsed.postedAt,
            description: parsed.description,
            externalId: parsed.externalEventId,
            dedupeKey,
          })
          .returning({ id: events.id })

        for (const [legIdx, leg] of parsed.legs.entries()) {
          const instrumentId = instrumentMap.get(leg.instrumentCode.toUpperCase())
          if (!instrumentId) throw new Error(`Unknown instrument: ${leg.instrumentCode}`)

          // Category from user assignments
          const catKey = `${parsed.eventGroup}_${legIdx}`
          const catPath = params.categoryAssignments[catKey] ?? null
          const categoryId = catPath
            ? await resolveCategoryPath(userId, catPath, userCategories)
            : null

          await tx.insert(legs).values({
            userId,
            eventId: newEvent.id,
            instrumentId,
            unitCount: leg.amountMinor,
            categoryId,
          })
        }
      })

      importedCount++
    } catch (err) {
      errorCount++
      importErrors.push({ line, message: String(err), phase: 'insert' })
    }
  }

  // ── 5. Create File record ─────────────────────────────────────────────────
  const [file] = await db
    .insert(files)
    .values({
      userId,
      accountId,
      filename,
      importedCount,
      skippedCount,
      restoredCount,
      errorCount,
      skippedKeys,
      errors: importErrors,
    })
    .returning({ id: files.id })

  return file.id
}
