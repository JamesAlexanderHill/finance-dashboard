import { createServerFn } from '@tanstack/react-start';
import { and, eq } from 'drizzle-orm';
import { idInput, setOverrideInput } from '@finance/contracts';
import { getDb, instruments } from '@finance/db';
import { REPORTING_CURRENCY } from '@finance/domain';
import { activePriceOverrides, clearPriceOverride, setPriceOverride } from '@finance/imports';
import { priceAt, valueAccount } from '@finance/ledger';
import { add, mul, todayIso } from '@finance/shared';
import { loadInstrumentHoldings } from './holdings.server';
import { workspaceMiddleware } from './session';
import { loadValuationInputs } from './valuation.server';

/**
 * Holdings today per instrument: units across accounts, the applicable price (with staleness and
 * trade-priced flags), value in the instrument's currency and in AUD, and any display-only override.
 */
export const listHoldings = createServerFn({ method: 'GET' })
  .middleware([workspaceMiddleware])
  .handler(async ({ context }) => {
    const today = todayIso();
    const [all, valuation] = await Promise.all([loadInstrumentHoldings(context.workspaceId), loadValuationInputs(context.workspaceId)]);
    return all
      .filter((h) => h.perAccount.length > 0)
      .map(({ instrument, perAccount, units }) => {
        const values = perAccount.map((p) =>
          valueAccount(
            valuation.accounts.find((a) => a.id === p.account.id)!,
            today,
            valuation.prices,
            valuation.fx,
          ),
        );
        const unitsNow = units.at(-1)?.quantity ?? '0';
        const price = priceAt(valuation.prices.get(instrument.id) ?? [], today);
        const fx = instrument.currency === REPORTING_CURRENCY ? null : priceAt(valuation.fx.get(instrument.currency) ?? [], today);
        const missing = values.some((v) => v.status === 'missing');
        const override = valuation.overrides.get(instrument.id) ?? null;
        return {
          id: instrument.id,
          symbol: instrument.symbol,
          exchange: instrument.exchange,
          name: instrument.name,
          currency: instrument.currency,
          units: unitsNow,
          price,
          fx,
          /** Units × applicable price, in the instrument's currency. */
          value: price ? mul(unitsNow, price.price) : null,
          /** In AUD; null if a price or FX rate is missing (never converted 1:1). */
          aud: missing ? null : add('0', ...values.map((v) => v.aud ?? '0')),
          stale: values.some((v) => v.status === 'stale'),
          notes: [...new Set(values.flatMap((v) => v.notes))],
          /** Display only: never part of any total. */
          override: override ? { ...override, value: mul(unitsNow, override.price) } : null,
          accounts: perAccount.map((p) => ({
            id: p.account.id,
            name: p.account.name,
            institution: p.account.institution,
            units: p.series.at(-1)?.quantity ?? '0',
            mismatches: p.mismatches,
          })),
        };
      });
  });

/** Sets (or replaces) the display-only current price for an instrument or FX rate. */
export const setOverride = createServerFn({ method: 'POST' })
  .middleware([workspaceMiddleware])
  .validator(setOverrideInput)
  .handler(async ({ context, data }) => {
    const [instrument] = await getDb()
      .select()
      .from(instruments)
      .where(and(eq(instruments.id, data.instrumentId), eq(instruments.workspaceId, context.workspaceId)));
    if (!instrument) throw new Error('Instrument not found');
    await getDb().transaction((tx) =>
      setPriceOverride(tx, context.workspaceId, {
        instrumentId: instrument.id,
        price: data.price,
        currency: instrument.currency,
        setOn: todayIso(),
        userId: context.userId,
      }),
    );
  });

export const clearOverride = createServerFn({ method: 'POST' })
  .middleware([workspaceMiddleware])
  .validator(idInput)
  .handler(async ({ context, data }) => getDb().transaction((tx) => clearPriceOverride(tx, context.workspaceId, data.id)));

/** Separate unit-price, units-held and holding-value series for one instrument (ADR 0007). */
export const getInstrumentHistory = createServerFn({ method: 'GET' })
  .middleware([workspaceMiddleware])
  .validator(idInput)
  .handler(async ({ context, data }) => {
    const [[h], overrides] = await Promise.all([
      loadInstrumentHoldings(context.workspaceId, data.id),
      activePriceOverrides(getDb(), context.workspaceId),
    ]);
    if (!h) throw new Error('Instrument not found');
    const override = overrides.find((o) => o.instrumentId === data.id);
    return {
      instrument: {
        id: h.instrument.id,
        symbol: h.instrument.symbol,
        exchange: h.instrument.exchange,
        name: h.instrument.name,
        currency: h.instrument.currency,
      },
      // Extend the units step to today so the chart shows the current holding.
      units: h.units.length ? [...h.units, { on: todayIso(), quantity: h.units.at(-1)!.quantity }] : [],
      prices: h.prices,
      values: h.values,
      trades: h.trades.map((t) => ({ on: t.on, quantity: t.quantity, description: t.description })),
      /** The price that applies today, with staleness; and any display-only override. */
      current: priceAt(h.prices, todayIso()),
      override: override ? { price: override.price, setOn: override.setOn } : null,
      mismatches: h.perAccount.flatMap((p) => p.mismatches.map((m) => ({ ...m, account: p.account.name }))),
    };
  });
