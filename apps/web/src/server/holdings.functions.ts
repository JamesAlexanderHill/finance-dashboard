import { createServerFn } from '@tanstack/react-start';
import { idInput } from '@finance/contracts';
import { mul } from '@finance/shared';
import { todayIso } from '@finance/shared';
import { loadInstrumentHoldings } from './holdings.server';
import { workspaceMiddleware } from './session';

/** Current holdings per instrument, with a per-account breakdown and the latest price (never estimated). */
export const listHoldings = createServerFn({ method: 'GET' })
  .middleware([workspaceMiddleware])
  .handler(async ({ context }) => {
    const all = await loadInstrumentHoldings(context.workspaceId);
    return all
      .map(({ instrument, perAccount, units, prices }) => {
        const unitsNow = units.at(-1)?.quantity ?? '0';
        const price = prices.at(-1) ?? null;
        return {
          id: instrument.id,
          symbol: instrument.symbol,
          exchange: instrument.exchange,
          name: instrument.name,
          currency: instrument.currency,
          units: unitsNow,
          price,
          /** Units held now × the latest price; its date is the price's date. */
          value: price ? mul(unitsNow, price.price) : null,
          accounts: perAccount.map((p) => ({
            id: p.account.id,
            name: p.account.name,
            institution: p.account.institution,
            units: p.series.at(-1)?.quantity ?? '0',
            mismatches: p.mismatches,
          })),
        };
      })
      .filter((h) => h.accounts.length > 0);
  });

/** Separate unit-price, units-held and holding-value series for one instrument (ADR 0007). */
export const getInstrumentHistory = createServerFn({ method: 'GET' })
  .middleware([workspaceMiddleware])
  .validator(idInput)
  .handler(async ({ context, data }) => {
    const [h] = await loadInstrumentHoldings(context.workspaceId, data.id);
    if (!h) throw new Error('Instrument not found');
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
      mismatches: h.perAccount.flatMap((p) => p.mismatches.map((m) => ({ ...m, account: p.account.name }))),
    };
  });
