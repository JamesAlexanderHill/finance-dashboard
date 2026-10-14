import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { financialAccounts, getDb, institutions, instruments, priceObservations, transactions } from '@finance/db';
import { activePriceOverrides, livePriceCondition } from '@finance/imports';
import type { AccountValuationInput, PriceObservationInput } from '@finance/ledger';

export interface ValuationInputs {
  accounts: Array<AccountValuationInput & { institution: string; provider: string; accountType: string }>;
  /** Live price observations per instrument ID (FX instruments included). */
  prices: Map<string, PriceObservationInput[]>;
  /** Live FX observations per currency (AUD per unit). */
  fx: Map<string, PriceObservationInput[]>;
  /** Display-only overrides per instrument ID (never used in totals). */
  overrides: Map<string, { price: string; currency: string; setOn: string }>;
  instruments: Map<string, { symbol: string; exchange: string; name: string; currency: string }>;
}

/** Everything needed to value every account at any date, read once per request. */
export async function loadValuationInputs(workspaceId: string): Promise<ValuationInputs> {
  const db = getDb();
  const [accountRows, observationRows, movementRows, priceRows, instrumentRows, overrideRows] = await Promise.all([
    db
      .select({
        id: financialAccounts.id,
        name: financialAccounts.name,
        classification: financialAccounts.classification,
        commodityKind: financialAccounts.commodityKind,
        commodity: financialAccounts.commodity,
        accountType: financialAccounts.accountType,
        instrumentId: financialAccounts.instrumentId,
        instrumentCurrency: instruments.currency,
        institution: institutions.name,
        provider: institutions.provider,
      })
      .from(financialAccounts)
      .innerJoin(institutions, eq(institutions.id, financialAccounts.institutionId))
      .leftJoin(instruments, eq(instruments.id, financialAccounts.instrumentId))
      .where(
        and(
          eq(financialAccounts.workspaceId, workspaceId),
          sql`${financialAccounts.archivedAt} is null`,
          isNull(financialAccounts.mergedIntoId),
        ),
      ),
    // Balance observations from live statements, plus manual entries. A merged account's count toward its target.
    db.execute<{ account_id: string; observed_on: string; kind: string; balance: string; source: string }>(sql`
      select coalesce(fa.merged_into_id, bo.account_id) as account_id, bo.observed_on::text, bo.kind, bo.balance::text, bo.source
      from balance_observations bo join financial_accounts fa on fa.id = bo.account_id
      left join source_files sf on sf.id = bo.source_file_id
      where bo.workspace_id = ${workspaceId} and (bo.source_file_id is null or sf.deleted_at is null)
      order by bo.observed_on, bo.created_at`),
    db
      .select({ accountId: transactions.accountId, on: transactions.postedOn, quantity: transactions.amount })
      .from(transactions)
      .where(and(eq(transactions.workspaceId, workspaceId), eq(transactions.isSourceSupported, true), eq(transactions.isSuppressed, false)))
      .orderBy(asc(transactions.postedOn)),
    db
      .select({
        instrumentId: priceObservations.instrumentId,
        on: priceObservations.observedOn,
        price: priceObservations.price,
        currency: priceObservations.currency,
        priceType: priceObservations.priceType,
      })
      .from(priceObservations)
      .where(and(eq(priceObservations.workspaceId, workspaceId), livePriceCondition)),
    db.select().from(instruments).where(eq(instruments.workspaceId, workspaceId)),
    activePriceOverrides(db, workspaceId),
  ]);

  const observations = [...observationRows];
  const accounts = accountRows.map((a) => {
    const own = observations.filter((o) => o.account_id === a.id);
    const base = {
      id: a.id,
      name: a.name,
      classification: a.classification,
      kind: a.commodityKind,
      currency: a.commodityKind === 'instrument' ? (a.instrumentCurrency ?? 'AUD') : a.commodity,
      instrumentId: a.instrumentId,
      institution: a.institution,
      provider: a.provider,
      accountType: a.accountType,
      movements: movementRows.filter((m) => m.accountId === a.id).map((m) => ({ on: m.on, quantity: m.quantity })),
    };
    if (a.provider === 'manual') {
      return { ...base, manualValues: own.filter((o) => o.source === 'manual').map((o) => ({ on: o.observed_on, quantity: o.balance })) };
    }
    const opening = own.find((o) => o.kind === 'opening');
    const closings = own.filter((o) => o.kind === 'closing').map((o) => o.observed_on);
    return {
      ...base,
      opening: opening ? { on: opening.observed_on, quantity: opening.balance } : null,
      coverageEnd: closings.sort().at(-1) ?? null,
    };
  });

  const instrumentMap = new Map(instrumentRows.map((i) => [i.id, i]));
  const prices = new Map<string, PriceObservationInput[]>();
  const fx = new Map<string, PriceObservationInput[]>();
  for (const p of priceRows) {
    const instrument = instrumentMap.get(p.instrumentId);
    if (!instrument || p.currency !== instrument.currency) continue;
    const obs = { on: p.on, price: p.price, currency: p.currency, priceType: p.priceType };
    prices.set(p.instrumentId, [...(prices.get(p.instrumentId) ?? []), obs]);
    if (instrument.exchange === 'FX') fx.set(instrument.symbol, [...(fx.get(instrument.symbol) ?? []), obs]);
  }

  return {
    accounts,
    prices,
    fx,
    overrides: new Map(overrideRows.map((o) => [o.instrumentId, { price: o.price, currency: o.currency, setOn: o.setOn }])),
    instruments: new Map(instrumentRows.map((i) => [i.id, { symbol: i.symbol, exchange: i.exchange, name: i.name, currency: i.currency }])),
  };
}

/** Live FX observations per currency (AUD per unit), without loading accounts. */
export async function loadFxRates(workspaceId: string): Promise<Map<string, PriceObservationInput[]>> {
  const rows = await getDb()
    .select({
      symbol: instruments.symbol,
      on: priceObservations.observedOn,
      price: priceObservations.price,
      currency: priceObservations.currency,
      priceType: priceObservations.priceType,
    })
    .from(priceObservations)
    .innerJoin(instruments, eq(instruments.id, priceObservations.instrumentId))
    .where(and(eq(priceObservations.workspaceId, workspaceId), eq(instruments.exchange, 'FX'), livePriceCondition));
  const fx = new Map<string, PriceObservationInput[]>();
  for (const r of rows) {
    if (r.currency !== 'AUD') continue;
    fx.set(r.symbol, [...(fx.get(r.symbol) ?? []), { on: r.on, price: r.price, currency: r.currency, priceType: r.priceType }]);
  }
  return fx;
}
