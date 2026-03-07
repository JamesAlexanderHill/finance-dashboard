import { eq } from 'drizzle-orm'
import { db } from '~/db'
import { events, files, instruments, legs } from '~/db/schema'
import type { Category } from '~/db/schema'
import { computeDedupeKey } from '~/lib/dedupe'
import type { ParsedEvent } from '~/importers/canonical'
import type { RequestContext } from '../utils/context'
import { queryAccountById } from '../query/account'
import { queryEventByDedupeKey } from '../query/event'
import { queryCategoriesByUser } from '../query/category'

export interface InstrumentDraft {
  ticker: string
  name: string
  exponent: number
  /** If set, reuse this existing instrument ID — no creation needed. */
  existingId?: string
}

export interface CommitImportParams {
  accountId: string
  filename: string
  events: ParsedEvent[]
  instrumentDrafts: InstrumentDraft[]
  /** eventGroup_legIndex → category path (e.g. "food:coffee") */
  categoryAssignments: Record<string, string | null>
  restoreDeletedChosen: boolean
}

function resolveCategoryPath(
  userId: string,
  path: string,
  userCategories: Category[],
): string | null {
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

async function commitImport(ctx: RequestContext, params: CommitImportParams): Promise<string> {
  const { accountId, filename, restoreDeletedChosen } = params
  const { userId } = ctx

  // ── 1. Verify account ownership ────────────────────────────────────────────
  const account = await queryAccountById(userId, accountId)
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

  // ── 3. Load categories ────────────────────────────────────────────────────
  const userCategories = await queryCategoriesByUser(userId)

  // ── 4. Create file record upfront to get fileId ───────────────────────────
  const [file] = await db
    .insert(files)
    .values({
      userId,
      accountId,
      filename,
      importedCount: 0,
      skippedCount: 0,
      restoredCount: 0,
      errorCount: 0,
      skippedKeys: [],
      errors: [],
    })
    .returning({ id: files.id })
  const fileId = file.id

  // ── 5. Process events ─────────────────────────────────────────────────────
  let importedCount = 0
  let skippedCount = 0
  let restoredCount = 0
  let errorCount = 0
  const skippedKeys: string[] = []
  const importErrors: Array<{ line: number; message: string; phase: string }> = []

  for (let evIdx = 0; evIdx < params.events.length; evIdx++) {
    const parsed = params.events[evIdx]
    const line = evIdx + 2

    try {
      const primaryUnitCount = parsed.legs[0]?.amountMinor ?? BigInt(0)
      const dedupeKey = computeDedupeKey({
        accountId,
        externalEventId: parsed.externalEventId,
        effectiveAt: parsed.effectiveAt,
        primaryAmountMinor: primaryUnitCount,
        description: parsed.description,
      })

      const existing = await queryEventByDedupeKey(dedupeKey)

      if (existing) {
        if (!existing.deletedAt) {
          skippedCount++
          skippedKeys.push(dedupeKey)
          continue
        }
        if (restoreDeletedChosen) {
          await db.update(events).set({ deletedAt: null }).where(eq(events.id, existing.id))
          restoredCount++
        } else {
          skippedCount++
          skippedKeys.push(dedupeKey)
        }
        continue
      }

      await db.transaction(async (tx) => {
        const [newEvent] = await tx
          .insert(events)
          .values({
            userId,
            accountId,
            fileId,
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

          const catKey = `${parsed.eventGroup}_${legIdx}`
          const catPath = params.categoryAssignments[catKey] ?? null
          const categoryId = catPath ? resolveCategoryPath(userId, catPath, userCategories) : null

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

  // ── 6. Update file record with final counts ───────────────────────────────
  await db
    .update(files)
    .set({ importedCount, skippedCount, restoredCount, errorCount, skippedKeys, errors: importErrors })
    .where(eq(files.id, fileId))

  return fileId
}

export const importService = { commitImport }
