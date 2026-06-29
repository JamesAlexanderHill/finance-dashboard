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
  users,
  workspaceMembers,
  workspaces,
} from '~/db/schema'
import { createUserWithPersonalWorkspace } from '~/db/services'

// ─── Clear ────────────────────────────────────────────────────────────────────

/** Delete all data in dependency order. Dev-only. */
export async function clearAllData(): Promise<void> {
  await db.delete(eventRelations)
  await db.delete(lineItems)
  await db.delete(instrumentCheckpoints)
  await db.delete(instrumentRates)
  await db.delete(legs)
  await db.delete(events)
  await db.delete(files)
  await db.delete(categories)
  await db.delete(timelineAnnotations)
  // Clear defaultInstrumentId before deleting instruments (circular FK)
  await db.update(accounts).set({ defaultInstrumentId: null })
  await db.delete(instruments)
  await db.delete(accounts)
  await db.delete(workspaceMembers)
  await db.delete(workspaces)
  await db.delete(users)
}

/** `db`, or a transaction handle from `db.transaction` — both expose the same query builders. */
export type DbOrTx = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0]

/**
 * Delete a single workspace's data in dependency order, leaving the workspace,
 * its members, and users intact. Mirrors {@link clearAllData} but scoped by
 * `workspaceId`. Accepts an optional `executor` so callers (e.g. snapshot
 * import) can run the wipe + restore in one transaction. Dev-only.
 */
export async function clearWorkspaceData(workspaceId: string, executor: DbOrTx = db): Promise<void> {
  // event_relations has no workspace_id — scope it via the workspace's events.
  const wsEvents = await executor
    .select({ id: events.id })
    .from(events)
    .where(eq(events.workspaceId, workspaceId))
  const eventIds = wsEvents.map((e) => e.id)
  if (eventIds.length > 0) {
    await executor.delete(eventRelations).where(inArray(eventRelations.parentEventId, eventIds))
  }
  await executor.delete(lineItems).where(eq(lineItems.workspaceId, workspaceId))
  await executor.delete(instrumentCheckpoints).where(eq(instrumentCheckpoints.workspaceId, workspaceId))
  await executor.delete(instrumentRates).where(eq(instrumentRates.workspaceId, workspaceId))
  await executor.delete(legs).where(eq(legs.workspaceId, workspaceId))
  await executor.delete(events).where(eq(events.workspaceId, workspaceId))
  await executor.delete(files).where(eq(files.workspaceId, workspaceId))
  await executor.delete(categories).where(eq(categories.workspaceId, workspaceId))
  await executor.delete(timelineAnnotations).where(eq(timelineAnnotations.workspaceId, workspaceId))
  // Clear defaultInstrumentId before deleting instruments (circular FK).
  await executor.update(accounts).set({ defaultInstrumentId: null }).where(eq(accounts.workspaceId, workspaceId))
  await executor.delete(instruments).where(eq(instruments.workspaceId, workspaceId))
  await executor.delete(accounts).where(eq(accounts.workspaceId, workspaceId))
}

// ─── Result type ──────────────────────────────────────────────────────────────

export interface SeedResult {
  userIds: { userA: string; userB: string }
  workspaceId: string
}

// ─── Base seed ────────────────────────────────────────────────────────────────

/** Create Demo User A and B, each with a personal workspace, plus a shared "Joint Finances" workspace. */
export async function seedBase(): Promise<SeedResult> {
  const { user: userA } = await createUserWithPersonalWorkspace({
    name: 'Demo User A',
    email: 'demo-a@example.com',
    homeCurrencyCode: 'AUD',
  })
  const { user: userB } = await createUserWithPersonalWorkspace({
    name: 'Demo User B',
    email: 'demo-b@example.com',
    homeCurrencyCode: 'AUD',
  })

  const [shared] = await db
    .insert(workspaces)
    .values({ name: 'Joint Finances', isPersonal: false, ownerId: userA.id })
    .returning()

  await db.insert(workspaceMembers).values([
    { workspaceId: shared.id, userId: userA.id, role: 'owner' },
    { workspaceId: shared.id, userId: userB.id, role: 'member' },
  ])

  return { userIds: { userA: userA.id, userB: userB.id }, workspaceId: shared.id }
}

// ─── Sample events ────────────────────────────────────────────────────────────

/**
 * Seed 4 accounts, 7 instruments, 12 categories, and ~30 events spanning
 * Aug 2025–May 2026 into `workspaceId`. Covers every event type and table:
 * files, legs (categoryId + description), lineItems, eventRelations.
 */
export async function seedSampleEvents(workspaceId: string): Promise<void> {
  // ── Accounts ──────────────────────────────────────────────────────────────
  const [commbank, amex, wise, vanguard] = await db
    .insert(accounts)
    .values([
      { workspaceId, name: 'CommBank', color: 'blue' },
      { workspaceId, name: 'AMEX', color: 'rose' },
      { workspaceId, name: 'Wise', color: 'emerald' },
      { workspaceId, name: 'Vanguard', color: 'violet' },
    ])
    .returning()

  // ── Instruments ───────────────────────────────────────────────────────────
  const [commbankAud, amexAud, wiseAud, wiseNzd, wiseUsd, vanguardAud, vanguardVhy] = await db
    .insert(instruments)
    .values([
      { workspaceId, accountId: commbank.id, ticker: 'AUD', exponent: 2, name: 'Australian Dollar' },
      { workspaceId, accountId: amex.id, ticker: 'AUD', exponent: 2, name: 'Australian Dollar' },
      { workspaceId, accountId: wise.id, ticker: 'AUD', exponent: 2, name: 'Australian Dollar' },
      { workspaceId, accountId: wise.id, ticker: 'NZD', exponent: 2, name: 'New Zealand Dollar' },
      { workspaceId, accountId: wise.id, ticker: 'USD', exponent: 2, name: 'US Dollar' },
      { workspaceId, accountId: vanguard.id, ticker: 'AUD', exponent: 2, name: 'Australian Dollar' },
      { workspaceId, accountId: vanguard.id, ticker: 'VHY', exponent: 0, name: 'Vanguard High Yield ETF' },
    ])
    .returning()

  await Promise.all([
    db.update(accounts).set({ defaultInstrumentId: commbankAud.id }).where(eq(accounts.id, commbank.id)),
    db.update(accounts).set({ defaultInstrumentId: amexAud.id }).where(eq(accounts.id, amex.id)),
    db.update(accounts).set({ defaultInstrumentId: wiseAud.id }).where(eq(accounts.id, wise.id)),
    db.update(accounts).set({ defaultInstrumentId: vanguardVhy.id }).where(eq(accounts.id, vanguard.id)),
  ])

  // ── Categories (3 levels) ─────────────────────────────────────────────────
  const [income, , lifestyle, essential] = await db
    .insert(categories)
    .values([
      { workspaceId, name: 'Income' },
      { workspaceId, name: 'Savings' },
      { workspaceId, name: 'Lifestyle' },
      { workspaceId, name: 'Essential' },
    ])
    .returning()

  const [salary, dividends, food, , housing] = await db
    .insert(categories)
    .values([
      { workspaceId, parentId: income.id, name: 'Salary' },
      { workspaceId, parentId: income.id, name: 'Dividends' },
      { workspaceId, parentId: lifestyle.id, name: 'Food' },
      { workspaceId, parentId: essential.id, name: 'Transport' },
      { workspaceId, parentId: essential.id, name: 'Housing' },
    ])
    .returning()

  const [coffee, groceries, dining] = await db
    .insert(categories)
    .values([
      { workspaceId, parentId: food.id, name: 'Coffee' },
      { workspaceId, parentId: food.id, name: 'Groceries' },
      { workspaceId, parentId: food.id, name: 'Dining' },
    ])
    .returning()

  // ── Simulated CommBank import file (Aug 2025) ─────────────────────────────
  const [commbankFile] = await db
    .insert(files)
    .values({
      workspaceId,
      accountId: commbank.id,
      filename: 'commbank_aug2025.csv',
      importedCount: 3,
      skippedCount: 0,
      restoredCount: 0,
      errorCount: 0,
    })
    .returning()

  // ══════════════════════════════════════════════════════════════════════════
  // Aug 2025
  // ══════════════════════════════════════════════════════════════════════════

  // payout: salary (fileId = simulated import)
  const [aug25Salary] = await db.insert(events).values({
    workspaceId, accountId: commbank.id,
    effectiveAt: new Date('2025-08-01T00:00:00Z'),
    postedAt: new Date('2025-08-01T00:00:00Z'),
    description: 'Salary — Acme Corp',
    dedupeKey: 'seed:payout:salary:2025-08',
    fileId: commbankFile.id,
  }).returning()
  await db.insert(legs).values({
    workspaceId, eventId: aug25Salary.id,
    instrumentId: commbankAud.id, unitCount: BigInt(480000), categoryId: salary.id,
  })

  // purchase: Woolworths — lineItems splitting the grocery total
  const [aug25Woolies] = await db.insert(events).values({
    workspaceId, accountId: commbank.id,
    effectiveAt: new Date('2025-08-05T00:00:00Z'),
    postedAt: new Date('2025-08-06T00:00:00Z'),
    description: 'WOOLWORTHS 1234 PENRITH',
    dedupeKey: 'seed:purchase:woolworths:2025-08',
    fileId: commbankFile.id,
  }).returning()
  const [wooliesLeg] = await db.insert(legs).values({
    workspaceId, eventId: aug25Woolies.id,
    instrumentId: commbankAud.id, unitCount: BigInt(-12750), categoryId: groceries.id,
  }).returning()
  await db.insert(lineItems).values([
    { workspaceId, legId: wooliesLeg.id, unitCount: BigInt(-4850), categoryId: groceries.id, description: 'Fresh produce' },
    { workspaceId, legId: wooliesLeg.id, unitCount: BigInt(-5200), categoryId: groceries.id, description: 'Meat & seafood' },
    { workspaceId, legId: wooliesLeg.id, unitCount: BigInt(-2700), categoryId: groceries.id, description: 'Dairy & eggs' },
  ])

  // bill_payment: rent direct debit
  const [aug25Rent] = await db.insert(events).values({
    workspaceId, accountId: commbank.id,
    effectiveAt: new Date('2025-08-07T00:00:00Z'),
    postedAt: new Date('2025-08-07T00:00:00Z'),
    description: 'Direct debit — 42 Balmain St',
    dedupeKey: 'seed:bill_payment:rent:2025-08',
    fileId: commbankFile.id,
  }).returning()
  await db.insert(legs).values({
    workspaceId, eventId: aug25Rent.id,
    instrumentId: commbankAud.id, unitCount: BigInt(-240000), categoryId: housing.id,
  })

  // ══════════════════════════════════════════════════════════════════════════
  // Sep 2025
  // ══════════════════════════════════════════════════════════════════════════

  // payout: salary
  const [sep25Salary] = await db.insert(events).values({
    workspaceId, accountId: commbank.id,
    effectiveAt: new Date('2025-09-01T00:00:00Z'),
    postedAt: new Date('2025-09-01T00:00:00Z'),
    description: 'Salary — Acme Corp',
    dedupeKey: 'seed:payout:salary:2025-09',
  }).returning()
  await db.insert(legs).values({
    workspaceId, eventId: sep25Salary.id,
    instrumentId: commbankAud.id, unitCount: BigInt(480000), categoryId: salary.id,
  })

  // bill_payment: Netflix on AMEX (leg description used)
  const [sep25Netflix] = await db.insert(events).values({
    workspaceId, accountId: amex.id,
    effectiveAt: new Date('2025-09-03T00:00:00Z'),
    postedAt: new Date('2025-09-03T00:00:00Z'),
    description: 'NETFLIX.COM',
    dedupeKey: 'seed:bill_payment:netflix:2025-09',
  }).returning()
  await db.insert(legs).values({
    workspaceId, eventId: sep25Netflix.id,
    instrumentId: amexAud.id, unitCount: BigInt(-2299), categoryId: lifestyle.id,
    description: 'Monthly streaming subscription',
  })

  // transfer: CommBank → Wise $1,500 (eventRelation pair)
  const [sep25TransOut] = await db.insert(events).values({
    workspaceId, accountId: commbank.id,
    effectiveAt: new Date('2025-09-10T00:00:00Z'),
    postedAt: new Date('2025-09-10T00:00:00Z'),
    description: 'Transfer to Wise',
    dedupeKey: 'seed:transfer:commbank-wise-out:2025-09',
  }).returning()
  await db.insert(legs).values({
    workspaceId, eventId: sep25TransOut.id,
    instrumentId: commbankAud.id, unitCount: BigInt(-150000),
  })
  const [sep25TransIn] = await db.insert(events).values({
    workspaceId, accountId: wise.id,
    effectiveAt: new Date('2025-09-10T00:00:00Z'),
    postedAt: new Date('2025-09-10T00:00:00Z'),
    description: 'Received from CommBank',
    dedupeKey: 'seed:transfer:commbank-wise-in:2025-09',
  }).returning()
  await db.insert(legs).values({
    workspaceId, eventId: sep25TransIn.id,
    instrumentId: wiseAud.id, unitCount: BigInt(150000),
  })
  await db.insert(eventRelations).values({
    parentEventId: sep25TransOut.id, childEventId: sep25TransIn.id, relationType: 'transfer',
  })

  // ══════════════════════════════════════════════════════════════════════════
  // Oct 2025
  // ══════════════════════════════════════════════════════════════════════════

  // payout: salary
  const [oct25Salary] = await db.insert(events).values({
    workspaceId, accountId: commbank.id,
    effectiveAt: new Date('2025-10-01T00:00:00Z'),
    postedAt: new Date('2025-10-01T00:00:00Z'),
    description: 'Salary — Acme Corp',
    dedupeKey: 'seed:payout:salary:2025-10',
  }).returning()
  await db.insert(legs).values({
    workspaceId, eventId: oct25Salary.id,
    instrumentId: commbankAud.id, unitCount: BigInt(480000), categoryId: salary.id,
  })

  // exchange: Wise AUD → USD ($1,200 AUD → $793 USD) — per-leg descriptions
  const [oct25Exchange] = await db.insert(events).values({
    workspaceId, accountId: wise.id,
    effectiveAt: new Date('2025-10-14T00:00:00Z'),
    postedAt: new Date('2025-10-14T00:00:00Z'),
    description: 'Converted $1,200 AUD to USD',
    dedupeKey: 'seed:exchange:wise-aud-usd:2025-10',
  }).returning()
  await db.insert(legs).values([
    { workspaceId, eventId: oct25Exchange.id, instrumentId: wiseAud.id, unitCount: BigInt(-120000), description: 'AUD sold' },
    { workspaceId, eventId: oct25Exchange.id, instrumentId: wiseUsd.id, unitCount: BigInt(79300), description: 'USD received' },
  ])

  // purchase: Dan Murphy's on AMEX
  const [oct25DanMurphys] = await db.insert(events).values({
    workspaceId, accountId: amex.id,
    effectiveAt: new Date('2025-10-19T00:00:00Z'),
    postedAt: new Date('2025-10-19T00:00:00Z'),
    description: 'DAN MURPHYS PARRAMATTA',
    dedupeKey: 'seed:purchase:danmurphys:2025-10',
  }).returning()
  await db.insert(legs).values({
    workspaceId, eventId: oct25DanMurphys.id,
    instrumentId: amexAud.id, unitCount: BigInt(-9500), categoryId: lifestyle.id,
  })

  // ══════════════════════════════════════════════════════════════════════════
  // Nov 2025
  // ══════════════════════════════════════════════════════════════════════════

  // payout: salary
  const [nov25Salary] = await db.insert(events).values({
    workspaceId, accountId: commbank.id,
    effectiveAt: new Date('2025-11-01T00:00:00Z'),
    postedAt: new Date('2025-11-01T00:00:00Z'),
    description: 'Salary — Acme Corp',
    dedupeKey: 'seed:payout:salary:2025-11',
  }).returning()
  await db.insert(legs).values({
    workspaceId, eventId: nov25Salary.id,
    instrumentId: commbankAud.id, unitCount: BigInt(480000), categoryId: salary.id,
  })

  // transfer: CommBank → Vanguard $3,000 investment contribution (pair)
  const [nov25InvOut] = await db.insert(events).values({
    workspaceId, accountId: commbank.id,
    effectiveAt: new Date('2025-11-05T00:00:00Z'),
    postedAt: new Date('2025-11-05T00:00:00Z'),
    description: 'Investment contribution',
    dedupeKey: 'seed:transfer:commbank-vanguard-out:2025-11',
  }).returning()
  await db.insert(legs).values({
    workspaceId, eventId: nov25InvOut.id,
    instrumentId: commbankAud.id, unitCount: BigInt(-300000),
  })
  const [nov25InvIn] = await db.insert(events).values({
    workspaceId, accountId: vanguard.id,
    effectiveAt: new Date('2025-11-05T00:00:00Z'),
    postedAt: new Date('2025-11-05T00:00:00Z'),
    description: 'Investment received from CommBank',
    dedupeKey: 'seed:transfer:commbank-vanguard-in:2025-11',
  }).returning()
  await db.insert(legs).values({
    workspaceId, eventId: nov25InvIn.id,
    instrumentId: vanguardAud.id, unitCount: BigInt(300000),
  })
  await db.insert(eventRelations).values({
    parentEventId: nov25InvOut.id, childEventId: nov25InvIn.id, relationType: 'transfer',
  })

  // trade: Buy 60 VHY @ $45.80 ($2,748 total) — per-leg descriptions
  const [nov25VhyBuy] = await db.insert(events).values({
    workspaceId, accountId: vanguard.id,
    effectiveAt: new Date('2025-11-08T00:00:00Z'),
    postedAt: new Date('2025-11-08T00:00:00Z'),
    description: 'Buy VHY ×60 @ $45.80',
    dedupeKey: 'seed:trade:vhy-buy-60:2025-11',
  }).returning()
  await db.insert(legs).values([
    { workspaceId, eventId: nov25VhyBuy.id, instrumentId: vanguardVhy.id, unitCount: BigInt(60), description: '+60 units acquired' },
    { workspaceId, eventId: nov25VhyBuy.id, instrumentId: vanguardAud.id, unitCount: BigInt(-274800), description: 'Settlement' },
  ])

  // bill_payment: electricity
  const [nov25Elec] = await db.insert(events).values({
    workspaceId, accountId: commbank.id,
    effectiveAt: new Date('2025-11-20T00:00:00Z'),
    postedAt: new Date('2025-11-20T00:00:00Z'),
    description: 'AUSGRID ELECTRICITY',
    dedupeKey: 'seed:bill_payment:electricity:2025-11',
  }).returning()
  await db.insert(legs).values({
    workspaceId, eventId: nov25Elec.id,
    instrumentId: commbankAud.id, unitCount: BigInt(-18740), categoryId: essential.id,
  })

  // ══════════════════════════════════════════════════════════════════════════
  // Dec 2025
  // ══════════════════════════════════════════════════════════════════════════

  // payout: salary
  const [dec25Salary] = await db.insert(events).values({
    workspaceId, accountId: commbank.id,
    effectiveAt: new Date('2025-12-01T00:00:00Z'),
    postedAt: new Date('2025-12-01T00:00:00Z'),
    description: 'Salary — Acme Corp',
    dedupeKey: 'seed:payout:salary:2025-12',
  }).returning()
  await db.insert(legs).values({
    workspaceId, eventId: dec25Salary.id,
    instrumentId: commbankAud.id, unitCount: BigInt(480000), categoryId: salary.id,
  })

  // payout: Christmas bonus
  const [dec25Bonus] = await db.insert(events).values({
    workspaceId, accountId: commbank.id,
    effectiveAt: new Date('2025-12-15T00:00:00Z'),
    postedAt: new Date('2025-12-15T00:00:00Z'),
    description: 'Year-end bonus — Acme Corp',
    dedupeKey: 'seed:payout:bonus:2025-12',
  }).returning()
  await db.insert(legs).values({
    workspaceId, eventId: dec25Bonus.id,
    instrumentId: commbankAud.id, unitCount: BigInt(200000), categoryId: salary.id,
  })

  // ══════════════════════════════════════════════════════════════════════════
  // Jan 2026
  // ══════════════════════════════════════════════════════════════════════════

  // payout: salary
  const [jan26Salary] = await db.insert(events).values({
    workspaceId, accountId: commbank.id,
    effectiveAt: new Date('2026-01-01T00:00:00Z'),
    postedAt: new Date('2026-01-01T00:00:00Z'),
    description: 'Salary — Acme Corp',
    dedupeKey: 'seed:payout:salary:2026-01',
  }).returning()
  await db.insert(legs).values({
    workspaceId, eventId: jan26Salary.id,
    instrumentId: commbankAud.id, unitCount: BigInt(480000), categoryId: salary.id,
  })

  // purchase: Coles — lineItems across multiple sub-categories
  const [jan26Coles] = await db.insert(events).values({
    workspaceId, accountId: commbank.id,
    effectiveAt: new Date('2026-01-08T00:00:00Z'),
    postedAt: new Date('2026-01-08T00:00:00Z'),
    description: 'COLES SUPERMARKETS PENRITH',
    dedupeKey: 'seed:purchase:coles:2026-01',
  }).returning()
  const [colesLeg] = await db.insert(legs).values({
    workspaceId, eventId: jan26Coles.id,
    instrumentId: commbankAud.id, unitCount: BigInt(-9840), categoryId: groceries.id,
  }).returning()
  await db.insert(lineItems).values([
    { workspaceId, legId: colesLeg.id, unitCount: BigInt(-6290), categoryId: groceries.id, description: 'Pantry & fridge' },
    { workspaceId, legId: colesLeg.id, unitCount: BigInt(-1850), categoryId: coffee.id, description: 'Coffee beans' },
    { workspaceId, legId: colesLeg.id, unitCount: BigInt(-1700), categoryId: lifestyle.id, description: 'Wine' },
  ])

  // ══════════════════════════════════════════════════════════════════════════
  // Feb 2026
  // ══════════════════════════════════════════════════════════════════════════

  // payout: salary
  const [feb26Salary] = await db.insert(events).values({
    workspaceId, accountId: commbank.id,
    effectiveAt: new Date('2026-02-01T00:00:00Z'),
    postedAt: new Date('2026-02-01T00:00:00Z'),
    description: 'Salary — Acme Corp',
    dedupeKey: 'seed:payout:salary:2026-02',
  }).returning()
  await db.insert(legs).values({
    workspaceId, eventId: feb26Salary.id,
    instrumentId: commbankAud.id, unitCount: BigInt(480000), categoryId: salary.id,
  })

  // payout: VHY dividend ($3.80/unit × 60 = $228)
  const [feb26Dividend] = await db.insert(events).values({
    workspaceId, accountId: vanguard.id,
    effectiveAt: new Date('2026-02-14T00:00:00Z'),
    postedAt: new Date('2026-02-14T00:00:00Z'),
    description: 'VHY Distribution — Feb 2026',
    dedupeKey: 'seed:payout:vhy-dividend:2026-02',
  }).returning()
  await db.insert(legs).values({
    workspaceId, eventId: feb26Dividend.id,
    instrumentId: vanguardAud.id, unitCount: BigInt(22800), categoryId: dividends.id,
  })

  // purchase: Airbnb on AMEX
  const [feb26Airbnb] = await db.insert(events).values({
    workspaceId, accountId: amex.id,
    effectiveAt: new Date('2026-02-20T00:00:00Z'),
    postedAt: new Date('2026-02-20T00:00:00Z'),
    description: 'AIRBNB * HME7NKZF5',
    dedupeKey: 'seed:purchase:airbnb:2026-02',
  }).returning()
  await db.insert(legs).values({
    workspaceId, eventId: feb26Airbnb.id,
    instrumentId: amexAud.id, unitCount: BigInt(-48500), categoryId: lifestyle.id,
  })

  // ══════════════════════════════════════════════════════════════════════════
  // Mar 2026
  // ══════════════════════════════════════════════════════════════════════════

  // payout: salary
  const [mar26Salary] = await db.insert(events).values({
    workspaceId, accountId: commbank.id,
    effectiveAt: new Date('2026-03-01T00:00:00Z'),
    postedAt: new Date('2026-03-01T00:00:00Z'),
    description: 'Salary — Acme Corp',
    dedupeKey: 'seed:payout:salary:2026-03',
  }).returning()
  await db.insert(legs).values({
    workspaceId, eventId: mar26Salary.id,
    instrumentId: commbankAud.id, unitCount: BigInt(480000), categoryId: salary.id,
  })

  // trade: Sell 10 VHY @ $47.20 = $472 AUD
  const [mar26VhySell] = await db.insert(events).values({
    workspaceId, accountId: vanguard.id,
    effectiveAt: new Date('2026-03-15T00:00:00Z'),
    postedAt: new Date('2026-03-15T00:00:00Z'),
    description: 'Sell VHY ×10 @ $47.20',
    dedupeKey: 'seed:trade:vhy-sell-10:2026-03',
  }).returning()
  await db.insert(legs).values([
    { workspaceId, eventId: mar26VhySell.id, instrumentId: vanguardVhy.id, unitCount: BigInt(-10), description: '-10 units sold' },
    { workspaceId, eventId: mar26VhySell.id, instrumentId: vanguardAud.id, unitCount: BigInt(47200), description: 'Sale proceeds' },
  ])

  // ══════════════════════════════════════════════════════════════════════════
  // Apr 2026
  // ══════════════════════════════════════════════════════════════════════════

  // payout: salary
  const [apr26Salary] = await db.insert(events).values({
    workspaceId, accountId: commbank.id,
    effectiveAt: new Date('2026-04-01T00:00:00Z'),
    postedAt: new Date('2026-04-01T00:00:00Z'),
    description: 'Salary — Acme Corp',
    dedupeKey: 'seed:payout:salary:2026-04',
  }).returning()
  await db.insert(legs).values({
    workspaceId, eventId: apr26Salary.id,
    instrumentId: commbankAud.id, unitCount: BigInt(480000), categoryId: salary.id,
  })

  // bill_payment: car insurance on AMEX
  const [apr26Insurance] = await db.insert(events).values({
    workspaceId, accountId: amex.id,
    effectiveAt: new Date('2026-04-10T00:00:00Z'),
    postedAt: new Date('2026-04-10T00:00:00Z'),
    description: 'BUDGET DIRECT INSURANCE',
    dedupeKey: 'seed:bill_payment:insurance:2026-04',
  }).returning()
  await db.insert(legs).values({
    workspaceId, eventId: apr26Insurance.id,
    instrumentId: amexAud.id, unitCount: BigInt(-38900), categoryId: essential.id,
  })

  // transfer: CommBank → Wise $500 (pair)
  const [apr26TransOut] = await db.insert(events).values({
    workspaceId, accountId: commbank.id,
    effectiveAt: new Date('2026-04-20T00:00:00Z'),
    postedAt: new Date('2026-04-20T00:00:00Z'),
    description: 'Transfer to Wise',
    dedupeKey: 'seed:transfer:commbank-wise-out:2026-04',
  }).returning()
  await db.insert(legs).values({
    workspaceId, eventId: apr26TransOut.id,
    instrumentId: commbankAud.id, unitCount: BigInt(-50000),
  })
  const [apr26TransIn] = await db.insert(events).values({
    workspaceId, accountId: wise.id,
    effectiveAt: new Date('2026-04-20T00:00:00Z'),
    postedAt: new Date('2026-04-20T00:00:00Z'),
    description: 'Received from CommBank',
    dedupeKey: 'seed:transfer:commbank-wise-in:2026-04',
  }).returning()
  await db.insert(legs).values({
    workspaceId, eventId: apr26TransIn.id,
    instrumentId: wiseAud.id, unitCount: BigInt(50000),
  })
  await db.insert(eventRelations).values({
    parentEventId: apr26TransOut.id, childEventId: apr26TransIn.id, relationType: 'transfer',
  })

  // ══════════════════════════════════════════════════════════════════════════
  // May 2026
  // ══════════════════════════════════════════════════════════════════════════

  // payout: salary
  const [may26Salary] = await db.insert(events).values({
    workspaceId, accountId: commbank.id,
    effectiveAt: new Date('2026-05-01T00:00:00Z'),
    postedAt: new Date('2026-05-01T00:00:00Z'),
    description: 'Salary — Acme Corp',
    dedupeKey: 'seed:payout:salary:2026-05',
  }).returning()
  await db.insert(legs).values({
    workspaceId, eventId: may26Salary.id,
    instrumentId: commbankAud.id, unitCount: BigInt(480000), categoryId: salary.id,
  })

  // purchase: ALDI on CommBank
  const [may26Aldi] = await db.insert(events).values({
    workspaceId, accountId: commbank.id,
    effectiveAt: new Date('2026-05-12T00:00:00Z'),
    postedAt: new Date('2026-05-12T00:00:00Z'),
    description: 'ALDI STORES PENRITH',
    dedupeKey: 'seed:purchase:aldi:2026-05',
  }).returning()
  await db.insert(legs).values({
    workspaceId, eventId: may26Aldi.id,
    instrumentId: commbankAud.id, unitCount: BigInt(-6720), categoryId: groceries.id,
  })

  // exchange: Wise AUD → NZD for upcoming travel
  const [may26NzdExchange] = await db.insert(events).values({
    workspaceId, accountId: wise.id,
    effectiveAt: new Date('2026-05-18T00:00:00Z'),
    postedAt: new Date('2026-05-18T00:00:00Z'),
    description: 'Converted $500 AUD to NZD',
    dedupeKey: 'seed:exchange:wise-aud-nzd:2026-05',
  }).returning()
  await db.insert(legs).values([
    { workspaceId, eventId: may26NzdExchange.id, instrumentId: wiseAud.id, unitCount: BigInt(-50000), description: 'AUD sold' },
    { workspaceId, eventId: may26NzdExchange.id, instrumentId: wiseNzd.id, unitCount: BigInt(53500), description: 'NZD received' },
  ])

  // purchase: dinner on AMEX
  const [may26Dining] = await db.insert(events).values({
    workspaceId, accountId: amex.id,
    effectiveAt: new Date('2026-05-25T00:00:00Z'),
    postedAt: new Date('2026-05-25T00:00:00Z'),
    description: 'ARIA RESTAURANT SYDNEY',
    dedupeKey: 'seed:purchase:aria:2026-05',
  }).returning()
  await db.insert(legs).values({
    workspaceId, eventId: may26Dining.id,
    instrumentId: amexAud.id, unitCount: BigInt(-24800), categoryId: dining.id,
  })

  void [aug25Salary, aug25Rent, sep25Salary, sep25Netflix, oct25Salary, oct25DanMurphys,
    nov25Salary, nov25VhyBuy, nov25Elec, dec25Salary, dec25Bonus,
    jan26Salary, jan26Coles, feb26Salary, feb26Dividend, feb26Airbnb,
    mar26Salary, mar26VhySell, apr26Salary, apr26Insurance, apr26TransOut, apr26TransIn,
    may26Salary, may26Aldi, may26NzdExchange, may26Dining,
    aug25Woolies, sep25TransOut, sep25TransIn, oct25Exchange, nov25InvOut, nov25InvIn]

  // ── Timeline Annotations ──────────────────────────────────────────────────
  await db.insert(timelineAnnotations).values([
    {
      workspaceId,
      accountId: commbank.id,
      label: 'Salary raise',
      date: new Date('2026-01-01T00:00:00Z'),
      recurrence: null,
    },
    {
      workspaceId,
      accountId: commbank.id,
      label: 'Monthly rent',
      date: new Date('2025-08-07T00:00:00Z'),
      recurrence: { frequency: 'monthly' },
    },
    {
      workspaceId,
      accountId: vanguard.id,
      label: 'Annual rebalance',
      date: new Date('2025-11-01T00:00:00Z'),
      recurrence: { frequency: 'yearly' },
    },
  ])
}
