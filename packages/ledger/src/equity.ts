import { add, type DecimalString, type IsoDate } from '@finance/shared';
import type { PriceObservationInput } from './holdings';
import { valueAccount, type AccountValuationInput, type AccountValue } from './networth';

export interface EquityPoint {
  on: IsoDate;
  value: AccountValue;
  /** Paired liabilities; their values are negative (owed). */
  loans: AccountValue[];
  /** Paired asset accounts (offsets) whose balance reduces what the loans cost. */
  offsets: AccountValue[];
  /** Value − (loans − offsets) in AUD, or null when the asset has no value at the date. */
  equity: DecimalString | null;
  /** Some loan or offset could not be valued, so the equity leaves it out. */
  partial: boolean;
  /** Some input relies on a stale price, rate or carried-forward balance. */
  stale: boolean;
}

/**
 * An asset's equity at a date (feature 02): its value less its paired loans, plus its paired offsets,
 * each valued exactly as net worth values it. A paired liability is a loan and a paired asset an offset.
 * Display-only: it never feeds a total, since net worth already counts every account once.
 */
export function equityAt(
  asset: AccountValuationInput,
  paired: readonly AccountValuationInput[],
  on: IsoDate,
  prices: ReadonlyMap<string, readonly PriceObservationInput[]>,
  fxRates: ReadonlyMap<string, readonly PriceObservationInput[]>,
): EquityPoint {
  const value = valueAccount(asset, on, prices, fxRates);
  const values = paired.map((a) => valueAccount(a, on, prices, fxRates));
  const loans = values.filter((v) => v.classification === 'liability');
  const offsets = values.filter((v) => v.classification === 'asset');
  const all = [value, ...values];
  return {
    on,
    value,
    loans,
    offsets,
    // Liability values are already negative, so summing gives value − loans + offsets.
    equity: value.aud === null ? null : add(value.aud, ...values.filter((v) => v.aud !== null).map((v) => v.aud!)),
    partial: values.some((v) => v.status === 'missing' || v.status === 'untracked'),
    stale: all.some((v) => v.status === 'stale'),
  };
}
