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
import { checkpointService } from './checkpoint'
import { rateService } from './rate'

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

export interface BulkImportFile {
  filename: string
  events: ParsedEvent[]
}

export interface CommitBulkImportParams {
  accountId: string
  instrumentDrafts: InstrumentDraft[]
  restoreDeletedChosen: boolean
  files: BulkImportFile[]
}

export interface FileImportResult {
  fileId: string
  filename: string
  importedCount: number
  skippedCount: number
  restoredCount: number
  errorCount: number
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

/** Create any instrument drafts that don't already have an `existingId`, returning ticker.upper → id for all of them. */
async function resolveInstruments(
  ctx: RequestContext,
  accountId: string,
  drafts: InstrumentDraft[],
): Promise<Map<string, string>> {
  const { userId } = ctx
  const instrumentMap = new Map<string, string>()

  for (const draft of drafts) {
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

  return instrumentMap
}

/** Create a `files` row and import its events/legs against an already-resolved instrument map. */
async function commitEventsForFile(
  ctx: RequestContext,
  accountId: string,
  filename: string,
  parsedEvents: ParsedEvent[],
  instrumentMap: Map<string, string>,
  categoryAssignments: Record<string, string | null>,
  restoreDeletedChosen: boolean,
  userCategories: Category[],
): Promise<FileImportResult> {
  const { userId } = ctx

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

  let importedCount = 0
  let skippedCount = 0
  let restoredCount = 0
  let errorCount = 0
  const skippedKeys: string[] = []
  const importErrors: Array<{ line: number; message: string; phase: string }> = []

  for (let evIdx = 0; evIdx < parsedEvents.length; evIdx++) {
    const parsed = parsedEvents[evIdx]
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
          const catPath = categoryAssignments[catKey] ?? null
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

  await db
    .update(files)
    .set({ importedCount, skippedCount, restoredCount, errorCount, skippedKeys, errors: importErrors })
    .where(eq(files.id, fileId))

  return { fileId, filename, importedCount, skippedCount, restoredCount, errorCount }
}

async function commitImport(ctx: RequestContext, params: CommitImportParams): Promise<string> {
  const { accountId, filename, restoreDeletedChosen } = params
  const { userId } = ctx

  const account = await queryAccountById(userId, accountId)
  if (!account) throw new Error(`Account not found: ${accountId}`)

  const instrumentMap = await resolveInstruments(ctx, accountId, params.instrumentDrafts)
  const userCategories = await queryCategoriesByUser(userId)

  const result = await commitEventsForFile(
    ctx,
    accountId,
    filename,
    params.events,
    instrumentMap,
    params.categoryAssignments,
    restoreDeletedChosen,
    userCategories,
  )

  for (const instrumentId of new Set(instrumentMap.values())) {
    await checkpointService.refresh(ctx, instrumentId)
    await rateService.refresh(ctx, instrumentId)
  }

  return result.fileId
}

/** Commit several canonical CSV files in one run, sharing a single instrument resolution pass. */
async function commitBulkImport(ctx: RequestContext, params: CommitBulkImportParams): Promise<FileImportResult[]> {
  const { accountId, restoreDeletedChosen } = params
  const { userId } = ctx

  const account = await queryAccountById(userId, accountId)
  if (!account) throw new Error(`Account not found: ${accountId}`)

  const instrumentMap = await resolveInstruments(ctx, accountId, params.instrumentDrafts)
  const userCategories = await queryCategoriesByUser(userId)

  const results: FileImportResult[] = []
  for (const file of params.files) {
    const result = await commitEventsForFile(
      ctx,
      accountId,
      file.filename,
      file.events,
      instrumentMap,
      {},
      restoreDeletedChosen,
      userCategories,
    )
    results.push(result)
  }

  for (const instrumentId of new Set(instrumentMap.values())) {
    await checkpointService.refresh(ctx, instrumentId)
    await rateService.refresh(ctx, instrumentId)
  }

  return results
}

export const importService = { commitImport, commitBulkImport }
