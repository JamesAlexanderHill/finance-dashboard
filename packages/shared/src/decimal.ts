import Big from 'big.js';

/** Exact decimal arithmetic on string amounts. Never use JS numbers for money. */
export type DecimalString = string;

Big.DP = 12;
Big.RM = Big.roundHalfEven;

export const dec = (v: DecimalString | number | Big) => new Big(v);

export function add(...values: DecimalString[]): DecimalString {
  return values.reduce((acc, v) => acc.plus(v), new Big(0)).toString();
}

export const sub = (a: DecimalString, b: DecimalString): DecimalString => new Big(a).minus(b).toString();
export const mul = (a: DecimalString, b: DecimalString): DecimalString => new Big(a).times(b).toString();
export const neg = (a: DecimalString): DecimalString => new Big(a).times(-1).toString();
export const abs = (a: DecimalString): DecimalString => new Big(a).abs().toString();
export const cmp = (a: DecimalString, b: DecimalString): -1 | 0 | 1 => new Big(a).cmp(b) as -1 | 0 | 1;
export const eq = (a: DecimalString, b: DecimalString) => new Big(a).eq(b);
export const isZero = (a: DecimalString) => new Big(a).eq(0);
export const isNegative = (a: DecimalString) => new Big(a).lt(0);
export const isPositive = (a: DecimalString) => new Big(a).gt(0);
export const max = (a: DecimalString, b: DecimalString) => (cmp(a, b) >= 0 ? a : b);

/** Canonical form for hashing/comparison: no trailing zeros, `-0` → `0`. */
export function normalise(a: DecimalString): DecimalString {
  const s = new Big(a).toString();
  return s === '-0' ? '0' : s;
}

/** Fixed 2 dp string for display. */
export const toFixed2 = (a: DecimalString) => new Big(a).toFixed(2);

/** Lossy conversion for chart geometry only, never for totals. */
export const toNumber = (a: DecimalString) => new Big(a).toNumber();
