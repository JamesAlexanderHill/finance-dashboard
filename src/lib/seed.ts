import { db } from '~/db'
import {
  accounts,
  categories,
  eventRelations,
  events,
  importRuns,
  instruments,
  legs,
  lineItems,
  users,
  views,
} from '~/db/schema'

// ─── Clear ────────────────────────────────────────────────────────────────────

/** Delete all data in dependency order. Dev-only. */
export async function clearAllData(): Promise<void> {
  await db.delete(eventRelations)
  await db.delete(lineItems)
  await db.delete(legs)
  await db.delete(events)
  await db.delete(importRuns)
  await db.delete(categories)
  await db.delete(instruments)
  await db.delete(accounts)
  await db.delete(views)
  await db.delete(users)
}

// ─── Result type ──────────────────────────────────────────────────────────────

export interface SeedResult {
  userId: string
  accountIds: Record<string, string>
  instrumentIds: Record<string, string>
  categoryIds: Record<string, string>
  viewIds: Record<string, string>
}

// ─── Base seed ────────────────────────────────────────────────────────────────

/** Seed the single demo user, accounts, instruments, categories, and views. */
export async function seedBase(): Promise<SeedResult> {
  // ── User ──────────────────────────────────────────────────────────────────
  const [user] = await db
    .insert(users)
    .values({ name: 'Demo User', homeCurrencyCode: 'AUD' })
    .returning()

  // ── Accounts ──────────────────────────────────────────────────────────────
  const [commbank, amex, wise, vanguardCash, vanguardHoldings] = await db
    .insert(accounts)
    .values([
      { userId: user.id, name: 'CommBank Everyday', importerKey: 'canonical_csv_v1' },
      { userId: user.id, name: 'AMEX', importerKey: 'canonical_csv_v1' },
      { userId: user.id, name: 'Wise', importerKey: 'canonical_csv_v1' },
      { userId: user.id, name: 'Vanguard Cash', importerKey: 'canonical_csv_v1' },
      { userId: user.id, name: 'Vanguard Holdings', importerKey: 'canonical_csv_v1' },
    ])
    .returning()

  // ── Instruments (account-scoped) ─────────────────────────────────────────
  const [cbAud, amexAud, wiseAud, wiseUsd, vCashAud, vHoldVdal] = await db
    .insert(instruments)
    .values([
      { userId: user.id, accountId: commbank.id, code: 'AUD', kind: 'fiat', minorUnit: 2, name: 'Australian Dollar' },
      { userId: user.id, accountId: amex.id, code: 'AUD', kind: 'fiat', minorUnit: 2, name: 'Australian Dollar' },
      { userId: user.id, accountId: wise.id, code: 'AUD', kind: 'fiat', minorUnit: 2, name: 'Australian Dollar' },
      { userId: user.id, accountId: wise.id, code: 'USD', kind: 'fiat', minorUnit: 2, name: 'US Dollar' },
      { userId: user.id, accountId: vanguardCash.id, code: 'AUD', kind: 'fiat', minorUnit: 2, name: 'Australian Dollar' },
      { userId: user.id, accountId: vanguardHoldings.id, code: 'VDAL', kind: 'security', minorUnit: 0, name: 'Vanguard Diversified All Growth ETF' },
    ])
    .returning()

  // ── Categories ────────────────────────────────────────────────────────────
  const [income, savings, lifestyle, essential] = await db
    .insert(categories)
    .values([
      { userId: user.id, name: 'Income', nameNormalized: 'income' },
      { userId: user.id, name: 'Savings', nameNormalized: 'savings' },
      { userId: user.id, name: 'Lifestyle', nameNormalized: 'lifestyle' },
      { userId: user.id, name: 'Essential', nameNormalized: 'essential' },
    ])
    .returning()

  // Sub-categories
  const [food, transport] = await db
    .insert(categories)
    .values([
      { userId: user.id, parentId: lifestyle.id, name: 'Food', nameNormalized: 'food' },
      { userId: user.id, parentId: essential.id, name: 'Transport', nameNormalized: 'transport' },
    ])
    .returning()

  const [coffee, groceries] = await db
    .insert(categories)
    .values([
      { userId: user.id, parentId: food.id, name: 'Coffee', nameNormalized: 'coffee' },
      { userId: user.id, parentId: food.id, name: 'Groceries', nameNormalized: 'groceries' },
    ])
    .returning()

  // ── Views ─────────────────────────────────────────────────────────────────
  const [personal, freelance] = await db
    .insert(views)
    .values([
      { userId: user.id, name: 'Personal', nameNormalized: 'personal' },
      { userId: user.id, name: 'Freelance', nameNormalized: 'freelance' },
    ])
    .returning()

  return {
    userId: user.id,
    accountIds: {
      commbank: commbank.id,
      amex: amex.id,
      wise: wise.id,
      vanguardCash: vanguardCash.id,
      vanguardHoldings: vanguardHoldings.id,
    },
    instrumentIds: {
      cbAud: cbAud.id,
      amexAud: amexAud.id,
      wiseAud: wiseAud.id,
      wiseUsd: wiseUsd.id,
      vCashAud: vCashAud.id,
      vHoldVdal: vHoldVdal.id,
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
    viewIds: {
      personal: personal.id,
      freelance: freelance.id,
    },
  }
}

// ─── Sample events ────────────────────────────────────────────────────────────

/** Seed sample purchase, transfer, exchange, and trade events. */
export async function seedSampleEvents(seed: SeedResult): Promise<void> {
  const { userId, accountIds, instrumentIds, categoryIds, viewIds } = seed
  const now = new Date()

  // Purchase: Woolworths $55.20 from CommBank
  const [purchase] = await db
    .insert(events)
    .values({
      userId,
      accountId: accountIds.commbank,
      eventType: 'purchase',
      effectiveAt: new Date('2025-01-10T00:00:00Z'),
      postedAt: new Date('2025-01-11T00:00:00Z'),
      description: 'WOOLWORTHS 1234 PENRITH',
      dedupeKey: 'seed:purchase:woolworths',
    })
    .returning()
  await db.insert(legs).values({
    userId,
    eventId: purchase.id,
    instrumentId: instrumentIds.cbAud,
    amountMinor: BigInt(-5520),
    categoryId: categoryIds.groceries,
  })

  // Transfer: CommBank → Wise $500 AUD
  const [transfer] = await db
    .insert(events)
    .values({
      userId,
      accountId: accountIds.commbank,
      eventType: 'transfer',
      effectiveAt: new Date('2025-01-15T00:00:00Z'),
      postedAt: new Date('2025-01-15T00:00:00Z'),
      description: 'Transfer to Wise',
      dedupeKey: 'seed:transfer:commbank-wise-out',
    })
    .returning()
  await db.insert(legs).values({
    userId,
    eventId: transfer.id,
    instrumentId: instrumentIds.cbAud,
    amountMinor: BigInt(-50000),
  })

  const [transferIn] = await db
    .insert(events)
    .values({
      userId,
      accountId: accountIds.wise,
      eventType: 'transfer',
      effectiveAt: new Date('2025-01-15T00:00:00Z'),
      postedAt: new Date('2025-01-15T00:00:00Z'),
      description: 'Transfer from CommBank',
      dedupeKey: 'seed:transfer:commbank-wise-in',
    })
    .returning()
  await db.insert(legs).values({
    userId,
    eventId: transferIn.id,
    instrumentId: instrumentIds.wiseAud,
    amountMinor: BigInt(50000),
  })

  // Link the two transfer events
  await db.insert(eventRelations).values({
    parentEventId: transfer.id,
    childEventId: transferIn.id,
    relationType: 'transfer_pair',
  })

  // Exchange: $100 USD → ~$158.73 AUD on Wise
  const [exchange] = await db
    .insert(events)
    .values({
      userId,
      accountId: accountIds.wise,
      eventType: 'exchange',
      effectiveAt: new Date('2025-02-01T00:00:00Z'),
      postedAt: new Date('2025-02-01T00:00:00Z'),
      description: 'Converted 100 USD to AUD',
      dedupeKey: 'seed:exchange:wise-usd-aud',
    })
    .returning()
  await db.insert(legs).values([
    { userId, eventId: exchange.id, instrumentId: instrumentIds.wiseUsd, amountMinor: BigInt(-10000) },
    { userId, eventId: exchange.id, instrumentId: instrumentIds.wiseAud, amountMinor: BigInt(15873) },
  ])

  // Trade: Buy 19 VDAL for $855 AUD
  const [trade] = await db
    .insert(events)
    .values({
      userId,
      accountId: accountIds.vanguardCash,
      eventType: 'trade',
      effectiveAt: new Date('2025-04-06T00:00:00Z'),
      postedAt: new Date('2025-04-06T00:00:00Z'),
      description: 'Buy VDAL x19',
      dedupeKey: 'seed:trade:vdal-buy-2025-04-06',
    })
    .returning()
  await db.insert(legs).values([
    { userId, eventId: trade.id, instrumentId: instrumentIds.vHoldVdal, amountMinor: BigInt(19) },
    { userId, eventId: trade.id, instrumentId: instrumentIds.vCashAud, amountMinor: BigInt(-85500) },
  ])
}
