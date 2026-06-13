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
  // Clear defaultInstrumentId before deleting instruments (circular FK)
  await db.update(accounts).set({ defaultInstrumentId: null })
  await db.delete(instruments)
  await db.delete(accounts)
  await db.delete(workspaceMembers)
  await db.delete(workspaces)
  await db.delete(users)
}

// ─── Result type ──────────────────────────────────────────────────────────────

export interface SeedResult {
  userId: string
  workspaceId: string
  accountIds: Record<string, string>
  instrumentIds: Record<string, string>
  categoryIds: Record<string, string>
}

// ─── Base seed ────────────────────────────────────────────────────────────────

/** Seed the single demo user, accounts, instruments, and categories. */
export async function seedBase(): Promise<SeedResult> {
  // ── User + personal workspace ────────────────────────────────────────────
  const { user, workspace } = await createUserWithPersonalWorkspace({
    name: 'Demo User',
    email: 'demo@example.com',
    homeCurrencyCode: 'AUD',
  })
  const workspaceId = workspace.id

  // ── Accounts ──────────────────────────────────────────────────────────────
  const [commbank, amex, wise, vanguard] = await db
    .insert(accounts)
    .values([
      { workspaceId, name: 'CommBank' },
      { workspaceId, name: 'AMEX' },
      { workspaceId, name: 'Wise' },
      { workspaceId, name: 'Vanguard' },
    ])
    .returning()

  // ── Instruments (account-scoped) ─────────────────────────────────────────
  const [commbankAud, amexAud, wiseAud, wiseNzd, vanguardAud, vanguardVhy] = await db
    .insert(instruments)
    .values([
      { workspaceId, accountId: commbank.id, ticker: 'AUD', exponent: 2, name: 'Australian Dollar' },
      { workspaceId, accountId: amex.id, ticker: 'AUD', exponent: 2, name: 'Australian Dollar' },
      { workspaceId, accountId: wise.id, ticker: 'AUD', exponent: 2, name: 'Australian Dollar' },
      { workspaceId, accountId: wise.id, ticker: 'NZD', exponent: 2, name: 'New Zealand Dollar' },
      { workspaceId, accountId: vanguard.id, ticker: 'AUD', exponent: 2, name: 'Australian Dollar' },
      { workspaceId, accountId: vanguard.id, ticker: 'VHY', exponent: 0, name: 'Vanguard Australian Shares High Yield ETF' },
    ])
    .returning()

  // ── Set default instruments on accounts ─────────────────────────────────
  const { eq } = await import('drizzle-orm')
  await Promise.all([
    db.update(accounts).set({ defaultInstrumentId: commbankAud.id }).where(eq(accounts.id, commbank.id)),
    db.update(accounts).set({ defaultInstrumentId: amexAud.id }).where(eq(accounts.id, amex.id)),
    db.update(accounts).set({ defaultInstrumentId: wiseAud.id }).where(eq(accounts.id, wise.id)),
    db.update(accounts).set({ defaultInstrumentId: vanguardAud.id }).where(eq(accounts.id, vanguard.id)),
    db.update(accounts).set({ defaultInstrumentId: vanguardVhy.id }).where(eq(accounts.id, vanguard.id)),
  ])

  // ── Categories ────────────────────────────────────────────────────────────
  const [income, savings, lifestyle, essential] = await db
    .insert(categories)
    .values([
      { workspaceId, name: 'Income' },
      { workspaceId, name: 'Savings' },
      { workspaceId, name: 'Lifestyle' },
      { workspaceId, name: 'Essential' },
    ])
    .returning()

  // Sub-categories
  const [food, transport] = await db
    .insert(categories)
    .values([
      { workspaceId, parentId: lifestyle.id, name: 'Food' },
      { workspaceId, parentId: essential.id, name: 'Transport' },
    ])
    .returning()

  const [coffee, groceries] = await db
    .insert(categories)
    .values([
      { workspaceId, parentId: food.id, name: 'Coffee' },
      { workspaceId, parentId: food.id, name: 'Groceries' },
    ])
    .returning()

  return {
    userId: user.id,
    workspaceId,
    accountIds: {
      commbank: commbank.id,
      amex: amex.id,
      wise: wise.id,
      vanguard: vanguard.id,
    },
    instrumentIds: {
      commbankAud: commbankAud.id,
      amexAud: amexAud.id,
      wiseAud: wiseAud.id,
      wiseNzd: wiseNzd.id,
      vanguardAud: vanguardAud.id,
      vanguardVhy: vanguardVhy.id,
    },
    categoryIds: {
      income: income.id,
      savings: savings.id,
      lifestyle: lifestyle.id,
      essential: essential.id,
      food: food.id,
      transport: transport.id,
      coffee: coffee.id,
      groceries: groceries.id,
    },
  }
}

// ─── Sample events ────────────────────────────────────────────────────────────

/** Seed sample purchase, transfer, exchange, and trade events. */
export async function seedSampleEvents(seed: SeedResult): Promise<void> {
  const { workspaceId, accountIds, instrumentIds, categoryIds } = seed

  // Purchase: Woolworths $55.20 from CommBank
  const [purchase] = await db
    .insert(events)
    .values({
      workspaceId,
      accountId: accountIds.commbank,
      effectiveAt: new Date('2025-01-10T00:00:00Z'),
      postedAt: new Date('2025-01-11T00:00:00Z'),
      description: 'WOOLWORTHS 1234 PENRITH',
      dedupeKey: 'seed:purchase:woolworths',
    })
    .returning()
  await db.insert(legs).values({
    workspaceId,
    eventId: purchase.id,
    instrumentId: instrumentIds.commbankAud,
    unitCount: BigInt(-5520),
    categoryId: categoryIds.groceries,
  })

  // Transfer: CommBank → Wise $500 AUD
  const [transfer] = await db
    .insert(events)
    .values({
      workspaceId,
      accountId: accountIds.commbank,
      effectiveAt: new Date('2025-01-15T00:00:00Z'),
      postedAt: new Date('2025-01-15T00:00:00Z'),
      description: 'Transfer to Wise',
      dedupeKey: 'seed:transfer:commbank-wise-out',
    })
    .returning()
  await db.insert(legs).values({
    workspaceId,
    eventId: transfer.id,
    instrumentId: instrumentIds.commbankAud,
    unitCount: BigInt(-50000),
  })

  const [transferIn] = await db
    .insert(events)
    .values({
      workspaceId,
      accountId: accountIds.wise,
      effectiveAt: new Date('2025-01-15T00:00:00Z'),
      postedAt: new Date('2025-01-15T00:00:00Z'),
      description: 'Transfer from CommBank',
      dedupeKey: 'seed:transfer:commbank-wise-in',
    })
    .returning()
  await db.insert(legs).values({
    workspaceId,
    eventId: transferIn.id,
    instrumentId: instrumentIds.wiseAud,
    unitCount: BigInt(50000),
  })

  // Link the two transfer events
  await db.insert(eventRelations).values({
    parentEventId: transfer.id,
    childEventId: transferIn.id,
    relationType: 'transfer_pair',
  })

  // Exchange: $100 NZD → ~$92.00 AUD on Wise
  const [exchange] = await db
    .insert(events)
    .values({
      workspaceId,
      accountId: accountIds.wise,
      effectiveAt: new Date('2025-02-01T00:00:00Z'),
      postedAt: new Date('2025-02-01T00:00:00Z'),
      description: 'Converted 100 NZD to AUD',
      dedupeKey: 'seed:exchange:wise-nzd-aud',
    })
    .returning()
  await db.insert(legs).values([
    { workspaceId, eventId: exchange.id, instrumentId: instrumentIds.wiseNzd, unitCount: BigInt(-10000) },
    { workspaceId, eventId: exchange.id, instrumentId: instrumentIds.wiseAud, unitCount: BigInt(9200) },
  ])

  // Trade: Buy 19 VHY for $855 AUD
  const [trade] = await db
    .insert(events)
    .values({
      workspaceId,
      accountId: accountIds.vanguard,
      effectiveAt: new Date('2025-04-06T00:00:00Z'),
      postedAt: new Date('2025-04-06T00:00:00Z'),
      description: 'Buy VHY x19',
      dedupeKey: 'seed:trade:vhy-buy-2025-04-06',
    })
    .returning()
  await db.insert(legs).values([
    { workspaceId, eventId: trade.id, instrumentId: instrumentIds.vanguardVhy, unitCount: BigInt(19) },
    { workspaceId, eventId: trade.id, instrumentId: instrumentIds.vanguardAud, unitCount: BigInt(-85500) },
  ])
}
