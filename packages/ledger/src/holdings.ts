import { add, eq, mul, type DecimalString, type IsoDate } from '@finance/shared';

export interface QuantityPoint {
  on: IsoDate;
  quantity: DecimalString;
}

/**
 * Units held over time: a verified opening position plus signed movements, as a step series with one
 * point per date the quantity changed (ADR 0007). Movements before the opening date are ignored, since
 * the opening position already includes them.
 */
export function unitsSeries(opening: QuantityPoint | null, movements: readonly QuantityPoint[]): QuantityPoint[] {
  const start = opening ?? { on: movements.map((m) => m.on).sort()[0] ?? '0000-01-01', quantity: '0' };
  const byDate = new Map<IsoDate, DecimalString>();
  for (const m of movements) if (m.on >= start.on) byDate.set(m.on, add(byDate.get(m.on) ?? '0', m.quantity));
  const points: QuantityPoint[] = [{ on: start.on, quantity: start.quantity }];
  let units = start.quantity;
  for (const on of [...byDate.keys()].sort()) {
    units = add(units, byDate.get(on)!);
    if (on === start.on) points[0] = { on, quantity: units };
    else points.push({ on, quantity: units });
  }
  return points;
}

/** Units held at a date (0 before the series starts). */
export function unitsAt(series: readonly QuantityPoint[], on: IsoDate): DecimalString {
  let units: DecimalString = '0';
  for (const p of series) {
    if (p.on > on) break;
    units = p.quantity;
  }
  return units;
}

export interface SnapshotCheck {
  on: IsoDate;
  reported: DecimalString;
  computed: DecimalString;
}

/** Position snapshots are checkpoints, never added to movements: report any that disagree with the series. */
export function snapshotMismatches(series: readonly QuantityPoint[], snapshots: readonly QuantityPoint[]): SnapshotCheck[] {
  return snapshots
    .map((s) => ({ on: s.on, reported: s.quantity, computed: unitsAt(series, s.on) }))
    .filter((c) => !eq(c.reported, c.computed));
}

export interface PriceObservationInput {
  on: IsoDate;
  price: DecimalString;
  currency: string;
  priceType: 'daily' | 'trade' | 'manual';
}

export interface EffectivePrice {
  on: IsoDate;
  price: DecimalString;
  currency: string;
  /** `trade` means no daily or manual price exists that day; the value is shown as trade-priced. */
  priceType: 'daily' | 'trade' | 'manual';
}

/**
 * One price per date: a manual price first (the user's explicit entry), then a daily price, and a
 * trade price only when neither exists. Equal prices from several sources collapse to one; callers
 * pass only live, non-conflicting observations. Several trades on one day use the last listed.
 */
export function effectivePrices(observations: readonly PriceObservationInput[]): EffectivePrice[] {
  const rank = { manual: 0, daily: 1, trade: 2 } as const;
  const best = new Map<IsoDate, PriceObservationInput>();
  for (const o of observations) {
    const current = best.get(o.on);
    if (!current || rank[o.priceType] < rank[current.priceType] || (o.priceType === 'trade' && current.priceType === 'trade'))
      best.set(o.on, o);
  }
  return [...best.values()]
    .sort((a, b) => a.on.localeCompare(b.on))
    .map(({ on, price, currency, priceType }) => ({ on, price, currency, priceType }));
}

export interface ValuePoint extends EffectivePrice {
  units: DecimalString;
  value: DecimalString;
}

/**
 * Holding value = units held at a date × that date's price, only on dates with a price. Prices are
 * never carried forward to other dates, so gaps stay visible instead of being fabricated.
 */
export function valueSeries(units: readonly QuantityPoint[], prices: readonly EffectivePrice[]): ValuePoint[] {
  return prices.map((p) => {
    const held = unitsAt(units, p.on);
    return { ...p, units: held, value: mul(held, p.price) };
  });
}
