import { describe, expect, test, beforeEach, afterAll } from 'bun:test'
import { eq, inArray, like } from 'drizzle-orm'
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
  users,
  workspaceMembers,
  workspaces,
} from '~/db/schema'
import { createUserWithPersonalWorkspace } from '~/db/services'
import { clearWorkspaceData } from '~/lib/seed'
import { exportWorkspaceSnapshot, importWorkspaceSnapshot } from '~/lib/snapshot'
import type { WorkspaceSnapshot } from '~/lib/snapshot'

/**
 * Round-trip test for the workspace snapshot export/import used by Dev Tools.
 * Seeds a self-contained graph (unique dedupe keys, so it won't collide with any
 * existing data) covering every workspace-scoped table, then asserts that
 * export → clear → import restores all rows and that bigint/date columns survive.
 *
 * Requires DATABASE_URL to point at a database with the schema pushed
 * (`bun db:push`). Skipped automatically when DATABASE_URL is unset.
 */

const hasDb = !!process.env.DATABASE_URL
const suite = hasDb ? describe : describe.skip
const TEST_DOMAIN = '@snapshottest.example'

/** Insert a complete fixture graph into `workspaceId`; `suffix` keeps dedupe keys unique. */
async function seedFixture(workspaceId: string, suffix: string) {
  const [acct] = await db
    .insert(accounts)
    .values({ workspaceId, name: 'Test Bank', color: 'blue' })
    .returning()

  const [aud, usd] = await db
    .insert(instruments)
    .values([
      { workspaceId, accountId: acct.id, ticker: 'AUD', exponent: 2, name: 'Australian Dollar' },
      { workspaceId, accountId: acct.id, ticker: 'USD', exponent: 2, name: 'US Dollar' },
    ])
    .returning()
  await db.update(accounts).set({ defaultInstrumentId: aud.id }).where(eq(accounts.id, acct.id))

  const [income] = await db.insert(categories).values({ workspaceId, name: 'Income' }).returning()
  const [salary] = await db
    .insert(categories)
    .values({ workspaceId, parentId: income.id, name: 'Salary' })
    .returning()

  const [file] = await db
    .insert(files)
    .values({
      workspaceId,
      accountId: acct.id,
      filename: 'fixture.csv',
      importedCount: 1,
      skippedKeys: ['k1'],
      errors: [{ line: 1, message: 'sample', phase: 'parse' }],
    })
    .returning()

  const [salaryEvent] = await db
    .insert(events)
    .values({
      workspaceId,
      accountId: acct.id,
      effectiveAt: new Date('2026-01-01T00:00:00Z'),
      postedAt: new Date('2026-01-01T00:00:00Z'),
      description: 'Salary',
      externalId: 'ext-1',
      dedupeKey: `snap:salary:${suffix}`,
      fileId: file.id,
    })
    .returning()
  const [salaryLeg] = await db
    .insert(legs)
    .values({
      workspaceId,
      eventId: salaryEvent.id,
      instrumentId: aud.id,
      unitCount: BigInt(480000),
      categoryId: salary.id,
      description: 'Pay',
    })
    .returning()
  await db.insert(lineItems).values([
    { workspaceId, legId: salaryLeg.id, unitCount: BigInt(300000), categoryId: salary.id, description: 'Base' },
    { workspaceId, legId: salaryLeg.id, unitCount: BigInt(180000), categoryId: salary.id, description: 'Bonus' },
  ])

  // Transfer pair → event relation.
  const [outEvent] = await db
    .insert(events)
    .values({
      workspaceId,
      accountId: acct.id,
      effectiveAt: new Date('2026-01-05T00:00:00Z'),
      postedAt: new Date('2026-01-05T00:00:00Z'),
      description: 'Transfer out',
      dedupeKey: `snap:out:${suffix}`,
    })
    .returning()
  await db.insert(legs).values({ workspaceId, eventId: outEvent.id, instrumentId: aud.id, unitCount: BigInt(-50000) })
  const [inEvent] = await db
    .insert(events)
    .values({
      workspaceId,
      accountId: acct.id,
      effectiveAt: new Date('2026-01-05T00:00:00Z'),
      postedAt: new Date('2026-01-05T00:00:00Z'),
      description: 'Transfer in',
      dedupeKey: `snap:in:${suffix}`,
    })
    .returning()
  await db.insert(legs).values({ workspaceId, eventId: inEvent.id, instrumentId: usd.id, unitCount: BigInt(33000) })
  await db
    .insert(eventRelations)
    .values({ parentEventId: outEvent.id, childEventId: inEvent.id, relationType: 'transfer_pair' })

  await db.insert(instrumentCheckpoints).values({
    workspaceId,
    instrumentId: aud.id,
    periodEnd: new Date('2026-02-01T00:00:00Z'),
    balance: BigInt(430000),
  })
  await db.insert(instrumentRates).values({
    workspaceId,
    instrumentId: usd.id,
    rate: 1.52,
    asOf: new Date('2026-01-05T00:00:00Z'),
    source: 'manual',
  })
  await db.insert(timelineAnnotations).values({
    workspaceId,
    accountId: acct.id,
    label: 'Payday',
    date: new Date('2026-01-01T00:00:00Z'),
    recurrence: { frequency: 'monthly' },
  })
}

/** Row counts for every workspace-scoped table (event_relations scoped via events). */
async function tableCounts(workspaceId: string) {
  const ev = await db.select({ id: events.id }).from(events).where(eq(events.workspaceId, workspaceId))
  const eventIds = ev.map((e) => e.id)
  const rel = eventIds.length
    ? await db.select().from(eventRelations).where(inArray(eventRelations.parentEventId, eventIds))
    : []
  const [acc, ins, cat, fil, leg, li, cp, rt, ann] = await Promise.all([
    db.select().from(accounts).where(eq(accounts.workspaceId, workspaceId)),
    db.select().from(instruments).where(eq(instruments.workspaceId, workspaceId)),
    db.select().from(categories).where(eq(categories.workspaceId, workspaceId)),
    db.select().from(files).where(eq(files.workspaceId, workspaceId)),
    db.select().from(legs).where(eq(legs.workspaceId, workspaceId)),
    db.select().from(lineItems).where(eq(lineItems.workspaceId, workspaceId)),
    db.select().from(instrumentCheckpoints).where(eq(instrumentCheckpoints.workspaceId, workspaceId)),
    db.select().from(instrumentRates).where(eq(instrumentRates.workspaceId, workspaceId)),
    db.select().from(timelineAnnotations).where(eq(timelineAnnotations.workspaceId, workspaceId)),
  ])
  return {
    accounts: acc.length,
    instruments: ins.length,
    categories: cat.length,
    files: fil.length,
    events: ev.length,
    legs: leg.length,
    lineItems: li.length,
    instrumentCheckpoints: cp.length,
    instrumentRates: rt.length,
    timelineAnnotations: ann.length,
    eventRelations: rel.length,
  }
}

async function cleanup() {
  const testUsers = await db.select({ id: users.id }).from(users).where(like(users.email, `%${TEST_DOMAIN}`))
  const ids = testUsers.map((u) => u.id)
  if (!ids.length) return
  const wsRows = await db.select({ id: workspaces.id }).from(workspaces).where(inArray(workspaces.ownerId, ids))
  for (const ws of wsRows) await clearWorkspaceData(ws.id)
  await db.delete(workspaceMembers).where(inArray(workspaceMembers.userId, ids))
  await db.delete(workspaces).where(inArray(workspaces.ownerId, ids))
  await db.delete(users).where(inArray(users.id, ids))
}

suite('workspace snapshot round-trip', () => {
  beforeEach(cleanup)
  afterAll(cleanup)

  test('export → clear → import restores every table and round-trips bigints/dates', async () => {
    const suffix = `${Date.now()}`
    const { workspace } = await createUserWithPersonalWorkspace({
      name: 'Snapshot Tester',
      email: `snap-${suffix}${TEST_DOMAIN}`,
      homeCurrencyCode: 'AUD',
    })
    await seedFixture(workspace.id, suffix)

    const before = await tableCounts(workspace.id)
    const snapshot = await exportWorkspaceSnapshot(workspace.id)

    // Snapshot is plain JSON: bigint → string, Date → string.
    expect(snapshot.version).toBe(1)
    expect(typeof snapshot.legs[0].unitCount).toBe('string')
    expect(typeof snapshot.events[0].effectiveAt).toBe('string')
    expect(snapshot.eventRelations).toHaveLength(1)

    await clearWorkspaceData(workspace.id)
    expect((await tableCounts(workspace.id)).events).toBe(0)

    await importWorkspaceSnapshot(workspace.id, snapshot)
    const after = await tableCounts(workspace.id)
    expect(after).toEqual(before)

    // bigints are BigInt again, with magnitudes preserved (480000 - 50000 + 33000).
    const restoredLegs = await db.select().from(legs).where(eq(legs.workspaceId, workspace.id))
    expect(typeof restoredLegs[0].unitCount).toBe('bigint')
    expect(restoredLegs.reduce((sum, l) => sum + l.unitCount, 0n)).toBe(463000n)

    // Manual rate survived with its source (not recomputed away).
    const [rate] = await db.select().from(instrumentRates).where(eq(instrumentRates.workspaceId, workspace.id))
    expect(rate.source).toBe('manual')
    expect(rate.rate).toBe(1.52)

    // Self-referential category parent restored.
    const cats = await db.select().from(categories).where(eq(categories.workspaceId, workspace.id))
    expect(cats.find((c) => c.name === 'Salary')?.parentId).toBe(cats.find((c) => c.name === 'Income')?.id)

    // Circular account.defaultInstrumentId restored.
    const [acct] = await db.select().from(accounts).where(eq(accounts.workspaceId, workspace.id))
    expect(acct.defaultInstrumentId).toBeTruthy()
  })

  test('a failed import rolls back, leaving the existing workspace data intact', async () => {
    const suffix = `${Date.now()}-rollback`
    const { workspace } = await createUserWithPersonalWorkspace({
      name: 'Rollback Tester',
      email: `rollback-${suffix}${TEST_DOMAIN}`,
      homeCurrencyCode: 'AUD',
    })
    await seedFixture(workspace.id, suffix)
    const before = await tableCounts(workspace.id)

    // Structurally valid, but every leg points at a non-existent instrument, so
    // the inserts fail partway through the wipe-then-restore transaction.
    const good = await exportWorkspaceSnapshot(workspace.id)
    const broken: WorkspaceSnapshot = {
      ...good,
      legs: good.legs.map((l) => ({ ...l, instrumentId: 'does-not-exist' })),
    }

    await expect(importWorkspaceSnapshot(workspace.id, broken)).rejects.toThrow()

    // The clear ran inside the same transaction, so the rollback restores everything.
    expect(await tableCounts(workspace.id)).toEqual(before)
  })
})
