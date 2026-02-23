import { eq } from "drizzle-orm";
import { db } from "../db";
import {
  accounts,
  categories,
  events,
  importRuns,
  instruments,
  legs,
  lineItems,
  eventRelations,
  profiles,
  users,
} from "../db/schema";

/**
 * Clear all user data in dependency order.
 * Safe for development only.
 */
export async function clearAllData(): Promise<void> {
  await db.delete(eventRelations);
  await db.delete(lineItems);
  await db.delete(legs);
  await db.delete(events);
  await db.delete(importRuns);
  await db.delete(categories);
  await db.delete(accounts);
  await db.delete(instruments);
  await db.delete(profiles);
  await db.delete(users);
}

export interface SeedResult {
  userId: string;
  profileId: string;
  instrumentIds: Record<string, string>;
  accountIds: Record<string, string>;
  categoryIds: Record<string, string>;
}

/**
 * Seed a single dummy user with a default profile, instruments, accounts, and categories.
 */
export async function seedBase(): Promise<SeedResult> {
  // ── User (home currency not set yet — set after instruments created) ─────────
  const [user] = await db.insert(users).values({}).returning();

  // ── Profile ──────────────────────────────────────────────────────────────────
  const [profile] = await db
    .insert(profiles)
    .values({ userId: user.id, name: "Personal" })
    .returning();

  // ── Instruments ──────────────────────────────────────────────────────────────
  const [aud, usd, vdal] = await db
    .insert(instruments)
    .values([
      { userId: user.id, code: "AUD", kind: "fiat", minorUnit: 2, name: "Australian Dollar" },
      { userId: user.id, code: "USD", kind: "fiat", minorUnit: 2, name: "US Dollar" },
      { userId: user.id, code: "VDAL", kind: "security", minorUnit: 0, name: "Vanguard Diversified All Growth ETF" },
    ])
    .returning();

  // Set home currency to AUD
  await db
    .update(users)
    .set({ homeCurrencyInstrumentId: aud.id, updatedAt: new Date() })
    .where(eq(users.id, user.id));

  // ── Accounts ─────────────────────────────────────────────────────────────────
  const [commbank, amex, wise, vanguardCash, vanguardHoldings] = await db
    .insert(accounts)
    .values([
      {
        userId: user.id,
        profileId: profile.id,
        name: "CommBank Everyday",
        importerKey: "commbank_csv_v1",
      },
      {
        userId: user.id,
        profileId: profile.id,
        name: "AMEX",
        importerKey: "commbank_csv_v1",
      },
      {
        userId: user.id,
        profileId: profile.id,
        name: "Wise",
        importerKey: "wise_csv_v1",
      },
      {
        userId: user.id,
        profileId: profile.id,
        name: "Vanguard Cash",
        importerKey: "vanguard_csv_v1",
      },
      {
        userId: user.id,
        profileId: profile.id,
        name: "Vanguard Holdings",
        importerKey: "vanguard_csv_v1",
      },
    ])
    .returning();

  // ── Categories ───────────────────────────────────────────────────────────────
  const [income, savings, lifestyle, essential] = await db
    .insert(categories)
    .values([
      { userId: user.id, name: "Income", normalizedName: "income" },
      { userId: user.id, name: "Savings", normalizedName: "savings" },
      { userId: user.id, name: "Lifestyle", normalizedName: "lifestyle" },
      { userId: user.id, name: "Essential", normalizedName: "essential" },
    ])
    .returning();

  return {
    userId: user.id,
    profileId: profile.id,
    instrumentIds: { AUD: aud.id, USD: usd.id, VDAL: vdal.id },
    accountIds: {
      commbank: commbank.id,
      amex: amex.id,
      wise: wise.id,
      vanguardCash: vanguardCash.id,
      vanguardHoldings: vanguardHoldings.id,
    },
    categoryIds: {
      income: income.id,
      savings: savings.id,
      lifestyle: lifestyle.id,
      essential: essential.id,
    },
  };
}

/** Seed a sample purchase and a sample transfer. */
export async function seedSampleEvents(seed: SeedResult): Promise<void> {
  const { userId, profileId, accountIds, instrumentIds } = seed;

  // Sample purchase: Woolworths $55.20 from CommBank
  const [purchase] = await db
    .insert(events)
    .values({
      userId,
      profileId,
      accountId: accountIds.commbank,
      eventType: "purchase",
      effectiveAt: new Date("2025-01-10T00:00:00Z"),
      description: "WOOLWORTHS 1234 PENRITH",
      dedupeKey: "seed:purchase:woolworths",
    })
    .returning();

  await db.insert(legs).values({
    eventId: purchase.id,
    accountId: accountIds.commbank,
    instrumentId: instrumentIds.AUD,
    amountMinor: BigInt(-5520),
    categoryId: seed.categoryIds.essential,
  });

  // Sample transfer: CommBank → Wise $500
  const [transfer] = await db
    .insert(events)
    .values({
      userId,
      profileId,
      accountId: accountIds.commbank,
      eventType: "transfer",
      effectiveAt: new Date("2025-01-15T00:00:00Z"),
      description: "Transfer to Wise",
      dedupeKey: "seed:transfer:commbank-wise",
    })
    .returning();

  await db.insert(legs).values([
    {
      eventId: transfer.id,
      accountId: accountIds.commbank,
      instrumentId: instrumentIds.AUD,
      amountMinor: BigInt(-50000),
    },
    {
      eventId: transfer.id,
      accountId: accountIds.wise,
      instrumentId: instrumentIds.AUD,
      amountMinor: BigInt(50000),
    },
  ]);
}

/** Seed the Vanguard trade example from the spec: Buy 19 VDAL for $855 AUD. */
export async function seedVanguardTrade(seed: SeedResult): Promise<void> {
  const { userId, profileId, accountIds, instrumentIds } = seed;

  const [trade] = await db
    .insert(events)
    .values({
      userId,
      profileId,
      accountId: accountIds.vanguardCash,
      eventType: "trade",
      effectiveAt: new Date("2025-04-06T00:00:00Z"),
      description: "Buy VDAL - Vanguard Diversified All Growth ETF",
      dedupeKey: "seed:trade:vdal-buy-2025-04-06",
      meta: { type: "Buy", productName: "Vanguard Diversified All Growth ETF", productId: "VDAL" },
    })
    .returning();

  await db.insert(legs).values([
    // +19 VDAL units (minorUnit=0, so amountMinor = 19)
    {
      eventId: trade.id,
      accountId: accountIds.vanguardHoldings,
      instrumentId: instrumentIds.VDAL,
      amountMinor: BigInt(19),
    },
    // -$855.00 AUD (minorUnit=2, so amountMinor = -85500)
    {
      eventId: trade.id,
      accountId: accountIds.vanguardCash,
      instrumentId: instrumentIds.AUD,
      amountMinor: BigInt(-85500),
    },
  ]);
}

/** Seed the Wise exchange example: USD → AUD at rate 0.63. */
export async function seedWiseExchange(seed: SeedResult): Promise<void> {
  const { userId, profileId, accountIds, instrumentIds } = seed;

  // Exchange: sell $100 USD, buy ~$158.73 AUD
  const [exchange] = await db
    .insert(events)
    .values({
      userId,
      profileId,
      accountId: accountIds.wise,
      eventType: "exchange",
      effectiveAt: new Date("2025-02-01T00:00:00Z"),
      description: "Converted 100 USD to AUD",
      dedupeKey: "seed:exchange:wise-usd-aud-2025-02-01",
      meta: { exchangeFrom: "USD", exchangeTo: "AUD", exchangeRate: 0.63 },
    })
    .returning();

  await db.insert(legs).values([
    // -$100.00 USD
    {
      eventId: exchange.id,
      accountId: accountIds.wise,
      instrumentId: instrumentIds.USD,
      amountMinor: BigInt(-10000),
    },
    // +$158.73 AUD (100 / 0.63 ≈ 158.73)
    {
      eventId: exchange.id,
      accountId: accountIds.wise,
      instrumentId: instrumentIds.AUD,
      amountMinor: BigInt(15873),
    },
  ]);
}
