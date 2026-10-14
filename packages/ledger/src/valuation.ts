import { addDays, mul, type DecimalString, type IsoDate } from '@finance/shared';
import type { PriceObservationInput } from './holdings';

/** The latest weekday strictly before `date`. Public holidays are ignored for now (PRD §7). */
export function previousBusinessDay(date: IsoDate): IsoDate {
  let d = addDays(date, -1);
  for (;;) {
    const weekday = new Date(`${d}T00:00:00Z`).getUTCDay();
    if (weekday !== 0 && weekday !== 6) return d;
    d = addDays(d, -1);
  }
}

/** A price or FX rate is stale once it is older than the previous business day's close. */
export const isStale = (observedOn: IsoDate, asOf: IsoDate) => observedOn < previousBusinessDay(asOf);

export interface AppliedPrice {
  on: IsoDate;
  price: DecimalString;
  priceType: 'daily' | 'trade' | 'manual';
  stale: boolean;
  /** Only a trade price was available within the staleness window. */
  tradePriced: boolean;
}

/**
 * The price (or FX rate) that applies at `asOf`, never using later observations:
 * 1. the latest fresh daily or manual price (manual wins on the same day);
 * 2. otherwise the latest fresh trade price, marked trade-priced;
 * 3. otherwise the latest observation of any type, marked stale.
 * Returns null when nothing has been observed on or before `asOf`.
 */
export function priceAt(observations: readonly PriceObservationInput[], asOf: IsoDate): AppliedPrice | null {
  const known = observations.filter((o) => o.on <= asOf);
  if (known.length === 0) return null;
  const rank = { manual: 0, daily: 1, trade: 2 } as const;
  const latest = (xs: PriceObservationInput[]) =>
    [...xs].sort((a, b) => b.on.localeCompare(a.on) || rank[a.priceType] - rank[b.priceType])[0];
  const fresh = known.filter((o) => !isStale(o.on, asOf));
  const daily = latest(fresh.filter((o) => o.priceType !== 'trade'));
  if (daily) return { on: daily.on, price: daily.price, priceType: daily.priceType, stale: false, tradePriced: false };
  const trade = latest(fresh);
  if (trade) return { on: trade.on, price: trade.price, priceType: trade.priceType, stale: false, tradePriced: true };
  const any = latest(known)!;
  return { on: any.on, price: any.price, priceType: any.priceType, stale: true, tradePriced: any.priceType === 'trade' };
}

/** Converts an amount with an applied rate (quote currency per unit). */
export const convert = (amount: DecimalString, rate: AppliedPrice) => mul(amount, rate.price);
