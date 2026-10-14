import { and, asc, eq, sql } from 'drizzle-orm';
import { financialAccounts, getDb, institutions, instruments, priceObservations, transactions } from '@finance/db';
import { livePriceCondition } from '@finance/imports';
import { effectivePrices, snapshotMismatches, unitsAt, unitsSeries, valueSeries, type QuantityPoint } from '@finance/ledger';
import { add } from '@finance/shared';

/** Everything needed to chart one instrument: per-account and combined units, effective prices and value. */
export async function loadInstrumentHoldings(workspaceId: string, instrumentId?: string) {
  const db = getDb();
  const instrumentRows = await db
    .select()
    .from(instruments)
    .where(and(eq(instruments.workspaceId, workspaceId), instrumentId ? eq(instruments.id, instrumentId) : undefined))
    .orderBy(asc(instruments.symbol));

  const accounts = await db
    .select({
      id: financialAccounts.id,
      name: financialAccounts.name,
      institution: institutions.name,
      instrumentId: financialAccounts.instrumentId,
    })
    .from(financialAccounts)
    .innerJoin(institutions, eq(institutions.id, financialAccounts.institutionId))
    .where(and(eq(financialAccounts.workspaceId, workspaceId), eq(financialAccounts.commodityKind, 'instrument')));

  // Opening positions and snapshots are balance observations from live statements (or manual entry).
  const observations = await db.execute<{ account_id: string; observed_on: string; kind: string; balance: string }>(sql`
    select bo.account_id, bo.observed_on::text, bo.kind, bo.balance::text
    from balance_observations bo left join source_files sf on sf.id = bo.source_file_id
    where bo.workspace_id = ${workspaceId} and (bo.source_file_id is null or sf.deleted_at is null)
    order by bo.observed_on`);

  const movements = await db
    .select({
      accountId: transactions.accountId,
      on: transactions.postedOn,
      quantity: transactions.amount,
      description: transactions.description,
    })
    .from(transactions)
    .innerJoin(financialAccounts, eq(financialAccounts.id, transactions.accountId))
    .where(
      and(
        eq(transactions.workspaceId, workspaceId),
        eq(financialAccounts.commodityKind, 'instrument'),
        eq(transactions.isSourceSupported, true),
        eq(transactions.isSuppressed, false),
      ),
    )
    .orderBy(asc(transactions.postedOn));

  const prices = await db
    .select({
      instrumentId: priceObservations.instrumentId,
      on: priceObservations.observedOn,
      price: priceObservations.price,
      currency: priceObservations.currency,
      priceType: priceObservations.priceType,
    })
    .from(priceObservations)
    .where(and(eq(priceObservations.workspaceId, workspaceId), livePriceCondition))
    .orderBy(asc(priceObservations.observedOn));

  return instrumentRows.map((instrument) => {
    const own = accounts.filter((a) => a.instrumentId === instrument.id);
    const perAccount = own.map((account) => {
      const obs = [...observations].filter((o) => o.account_id === account.id);
      const opening = obs.find((o) => o.kind === 'opening');
      const series = unitsSeries(
        opening ? { on: opening.observed_on, quantity: opening.balance } : null,
        movements.filter((m) => m.accountId === account.id),
      );
      const snapshots = obs.filter((o) => o.kind === 'closing').map((o) => ({ on: o.observed_on, quantity: o.balance }));
      return { account, series, mismatches: snapshotMismatches(series, snapshots) };
    });

    // Combined units: on every date any account changes, the sum of all accounts' units.
    const dates = [...new Set(perAccount.flatMap((p) => p.series.map((point) => point.on)))].sort();
    const units: QuantityPoint[] = dates.map((on) => ({ on, quantity: add('0', ...perAccount.map((p) => unitsAt(p.series, on))) }));
    const effective = effectivePrices(prices.filter((p) => p.instrumentId === instrument.id && p.currency === instrument.currency));
    return {
      instrument,
      perAccount,
      units,
      prices: effective,
      values: valueSeries(units, effective),
      trades: movements.filter((m) => own.some((a) => a.id === m.accountId)),
    };
  });
}
