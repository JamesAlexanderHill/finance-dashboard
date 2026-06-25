import { eq, inArray } from 'drizzle-orm'
import { db } from '~/db'
import {
  accounts,
  categories,
  eventRelations,
  events,
  files,
  instrumentCheckpoints,
  instrumentRates,
  instruments,
  legs,
  lineItems,
  timelineAnnotations,
  workspaces,
} from '~/db/schema'
import type {
  Account,
  Category,
  Event,
  EventRelation,
  File as FileRow,
  Instrument,
  InstrumentCheckpoint,
  InstrumentRate,
  Leg,
  LineItem,
  TimelineAnnotation,
} from '~/db/schema'
import { clearWorkspaceData } from '~/lib/seed'

// ─── Snapshot format ────────────────────────────────────────────────────────────
//
// A WorkspaceSnapshot is a plain-JSON capture of every workspace-scoped table for
// one workspace. `bigint` columns are serialized as strings and `Date` columns as
// ISO strings (JSON.stringify can't represent either), and converted back on import.

/** Rewrites a row type so `bigint` → `string` and `Date` → `string` (nullable variants preserved). */
type Jsonify<T> = {
  [K in keyof T]: T[K] extends bigint
    ? string
    : T[K] extends bigint | null
      ? string | null
      : T[K] extends Date
        ? string
        : T[K] extends Date | null
          ? string | null
          : T[K]
}

export interface WorkspaceSnapshot {
  version: 1
  exportedAt: string
  workspace: { name: string }
  accounts: Jsonify<Account>[]
  instruments: Jsonify<Instrument>[]
  categories: Jsonify<Category>[]
  files: Jsonify<FileRow>[]
  events: Jsonify<Event>[]
  legs: Jsonify<Leg>[]
  lineItems: Jsonify<LineItem>[]
  instrumentCheckpoints: Jsonify<InstrumentCheckpoint>[]
  instrumentRates: Jsonify<InstrumentRate>[]
  timelineAnnotations: Jsonify<TimelineAnnotation>[]
  eventRelations: EventRelation[]
}

export interface ImportCounts {
  accounts: number
  instruments: number
  categories: number
  events: number
  legs: number
}

// ─── Export ─────────────────────────────────────────────────────────────────────

/** Converts a DB row to plain JSON: bigint → string, Date → ISO string, everything else as-is. */
function serializeRow<T extends Record<string, unknown>>(row: T): Jsonify<T> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(row)) {
    if (typeof value === 'bigint') out[key] = value.toString()
    else if (value instanceof Date) out[key] = value.toISOString()
    else out[key] = value
  }
  return out as Jsonify<T>
}

/** Serialize the entire data graph for `workspaceId` into a plain-JSON snapshot. */
export async function exportWorkspaceSnapshot(workspaceId: string): Promise<WorkspaceSnapshot> {
  const [
    accountRows,
    instrumentRows,
    categoryRows,
    fileRows,
    eventRows,
    legRows,
    lineItemRows,
    checkpointRows,
    rateRows,
    annotationRows,
    workspaceRow,
  ] = await Promise.all([
    db.select().from(accounts).where(eq(accounts.workspaceId, workspaceId)),
    db.select().from(instruments).where(eq(instruments.workspaceId, workspaceId)),
    db.select().from(categories).where(eq(categories.workspaceId, workspaceId)),
    db.select().from(files).where(eq(files.workspaceId, workspaceId)),
    db.select().from(events).where(eq(events.workspaceId, workspaceId)),
    db.select().from(legs).where(eq(legs.workspaceId, workspaceId)),
    db.select().from(lineItems).where(eq(lineItems.workspaceId, workspaceId)),
    db.select().from(instrumentCheckpoints).where(eq(instrumentCheckpoints.workspaceId, workspaceId)),
    db.select().from(instrumentRates).where(eq(instrumentRates.workspaceId, workspaceId)),
    db.select().from(timelineAnnotations).where(eq(timelineAnnotations.workspaceId, workspaceId)),
    db.select().from(workspaces).where(eq(workspaces.id, workspaceId)),
  ])

  // event_relations carries no workspace_id — scope it via this workspace's events.
  const eventIds = eventRows.map((e) => e.id)
  const relationRows = eventIds.length
    ? await db.select().from(eventRelations).where(inArray(eventRelations.parentEventId, eventIds))
    : []

  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    workspace: { name: workspaceRow[0]?.name ?? 'Unknown' },
    accounts: accountRows.map(serializeRow),
    instruments: instrumentRows.map(serializeRow),
    categories: categoryRows.map(serializeRow),
    files: fileRows.map(serializeRow),
    events: eventRows.map(serializeRow),
    legs: legRows.map(serializeRow),
    lineItems: lineItemRows.map(serializeRow),
    instrumentCheckpoints: checkpointRows.map(serializeRow),
    instrumentRates: rateRows.map(serializeRow),
    timelineAnnotations: annotationRows.map(serializeRow),
    eventRelations: relationRows,
  }
}

// ─── Import ─────────────────────────────────────────────────────────────────────

const SNAPSHOT_ARRAYS = [
  'accounts',
  'instruments',
  'categories',
  'files',
  'events',
  'legs',
  'lineItems',
  'instrumentCheckpoints',
  'instrumentRates',
  'timelineAnnotations',
  'eventRelations',
] as const

/** Throws a friendly error if the parsed object isn't a v1 snapshot with the expected arrays. */
function assertValidSnapshot(snapshot: unknown): asserts snapshot is WorkspaceSnapshot {
  if (!snapshot || typeof snapshot !== 'object') throw new Error('Invalid snapshot: not an object.')
  const s = snapshot as Record<string, unknown>
  if (s.version !== 1) throw new Error(`Unsupported snapshot version: ${String(s.version)} (expected 1).`)
  for (const key of SNAPSHOT_ARRAYS) {
    if (!Array.isArray(s[key])) throw new Error(`Invalid snapshot: "${key}" is missing or not an array.`)
  }
}

/**
 * Restore a snapshot into `targetWorkspaceId`. Wipes that workspace's existing
 * data, then reinserts the snapshot in foreign-key dependency order — remapping
 * every row's `workspaceId` to the target while preserving all other IDs and
 * dedupe keys. Runs in a single transaction, so a malformed file rolls back
 * cleanly and the workspace is never left half-wiped. Dev-only.
 */
export async function importWorkspaceSnapshot(
  targetWorkspaceId: string,
  snapshot: WorkspaceSnapshot,
): Promise<ImportCounts> {
  assertValidSnapshot(snapshot)
  const ws = targetWorkspaceId

  await db.transaction(async (tx) => {
    await clearWorkspaceData(ws, tx)

    // accounts — defaultInstrumentId is set after instruments exist (circular FK).
    if (snapshot.accounts.length) {
      await tx.insert(accounts).values(
        snapshot.accounts.map((a) => ({
          id: a.id,
          workspaceId: ws,
          name: a.name,
          defaultInstrumentId: null,
          color: a.color,
          createdAt: new Date(a.createdAt),
        })),
      )
    }

    if (snapshot.instruments.length) {
      await tx.insert(instruments).values(
        snapshot.instruments.map((i) => ({
          id: i.id,
          workspaceId: ws,
          accountId: i.accountId,
          name: i.name,
          ticker: i.ticker,
          exponent: i.exponent,
        })),
      )
    }

    for (const a of snapshot.accounts) {
      if (a.defaultInstrumentId) {
        await tx.update(accounts).set({ defaultInstrumentId: a.defaultInstrumentId }).where(eq(accounts.id, a.id))
      }
    }

    // categories — parentId is set after all rows exist (self-referential FK).
    if (snapshot.categories.length) {
      await tx.insert(categories).values(
        snapshot.categories.map((c) => ({ id: c.id, workspaceId: ws, parentId: null, name: c.name })),
      )
      for (const c of snapshot.categories) {
        if (c.parentId) {
          await tx.update(categories).set({ parentId: c.parentId }).where(eq(categories.id, c.id))
        }
      }
    }

    if (snapshot.files.length) {
      await tx.insert(files).values(
        snapshot.files.map((f) => ({
          id: f.id,
          workspaceId: ws,
          accountId: f.accountId,
          filename: f.filename,
          createdAt: new Date(f.createdAt),
          importedCount: f.importedCount,
          skippedCount: f.skippedCount,
          restoredCount: f.restoredCount,
          errorCount: f.errorCount,
          skippedKeys: f.skippedKeys,
          errors: f.errors,
        })),
      )
    }

    if (snapshot.events.length) {
      await tx.insert(events).values(
        snapshot.events.map((e) => ({
          id: e.id,
          workspaceId: ws,
          accountId: e.accountId,
          effectiveAt: new Date(e.effectiveAt),
          postedAt: new Date(e.postedAt),
          description: e.description,
          externalId: e.externalId,
          dedupeKey: e.dedupeKey,
          fileId: e.fileId,
          deletedAt: e.deletedAt ? new Date(e.deletedAt) : null,
          createdAt: new Date(e.createdAt),
        })),
      )
    }

    if (snapshot.legs.length) {
      await tx.insert(legs).values(
        snapshot.legs.map((l) => ({
          id: l.id,
          workspaceId: ws,
          eventId: l.eventId,
          instrumentId: l.instrumentId,
          unitCount: BigInt(l.unitCount),
          categoryId: l.categoryId,
          description: l.description,
          createdAt: new Date(l.createdAt),
        })),
      )
    }

    if (snapshot.lineItems.length) {
      await tx.insert(lineItems).values(
        snapshot.lineItems.map((li) => ({
          id: li.id,
          workspaceId: ws,
          legId: li.legId,
          unitCount: BigInt(li.unitCount),
          categoryId: li.categoryId,
          description: li.description,
        })),
      )
    }

    if (snapshot.instrumentCheckpoints.length) {
      await tx.insert(instrumentCheckpoints).values(
        snapshot.instrumentCheckpoints.map((c) => ({
          id: c.id,
          workspaceId: ws,
          instrumentId: c.instrumentId,
          periodEnd: new Date(c.periodEnd),
          balance: BigInt(c.balance),
          createdAt: new Date(c.createdAt),
        })),
      )
    }

    if (snapshot.instrumentRates.length) {
      await tx.insert(instrumentRates).values(
        snapshot.instrumentRates.map((r) => ({
          id: r.id,
          workspaceId: ws,
          instrumentId: r.instrumentId,
          rate: r.rate,
          asOf: new Date(r.asOf),
          source: r.source,
          createdAt: new Date(r.createdAt),
        })),
      )
    }

    if (snapshot.timelineAnnotations.length) {
      await tx.insert(timelineAnnotations).values(
        snapshot.timelineAnnotations.map((a) => ({
          id: a.id,
          workspaceId: ws,
          accountId: a.accountId,
          label: a.label,
          date: new Date(a.date),
          endDate: a.endDate ? new Date(a.endDate) : null,
          recurrence: a.recurrence,
          color: a.color,
          createdAt: new Date(a.createdAt),
        })),
      )
    }

    if (snapshot.eventRelations.length) {
      await tx.insert(eventRelations).values(
        snapshot.eventRelations.map((er) => ({
          parentEventId: er.parentEventId,
          childEventId: er.childEventId,
          relationType: er.relationType,
        })),
      )
    }
  })

  return {
    accounts: snapshot.accounts.length,
    instruments: snapshot.instruments.length,
    categories: snapshot.categories.length,
    events: snapshot.events.length,
    legs: snapshot.legs.length,
  }
}
