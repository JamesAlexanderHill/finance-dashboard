import { add, isZero, mul, neg, type DecimalString, type IsoDate } from '@finance/shared';
import { REPORTING_CURRENCY } from '@finance/domain';
import type { PriceObservationInput, QuantityPoint } from './holdings';
import { unitsAt, unitsSeries } from './holdings';
import { priceAt, type AppliedPrice } from './valuation';

/**
 * A balance carried forward more than this many days past its last statement (or manual value) is
 * stale. Statements here are monthly to yearly, so this flags anything older than one monthly cycle.
 */
export const BALANCE_STALE_DAYS = 35;

export interface AccountValuationInput {
  id: string;
  name: string;
  classification: 'asset' | 'liability';
  /** `instrument`: amounts are units of `instrumentId`, priced in `currency`. */
  kind: 'currency' | 'instrument';
  /** The account's currency, or the instrument's pricing currency. */
  currency: string;
  instrumentId?: string | null;
  /** Statement accounts: earliest live opening balance (or position) and dated movements. */
  opening?: QuantityPoint | null;
  movements: QuantityPoint[];
  /** Date of the latest statement closing balance covering this account. */
  coverageEnd?: IsoDate | null;
  /** Manual accounts: dated values; the latest on or before the date applies. */
  manualValues?: QuantityPoint[];
}

export type ValueStatus = 'ok' | 'stale' | 'missing' | 'untracked';

export interface AccountValue {
  id: string;
  name: string;
  classification: 'asset' | 'liability';
  kind: 'currency' | 'instrument';
  currency: string;
  /** Balance or units held at the date (null before tracking starts). */
  quantity: DecimalString | null;
  /** Date the quantity is known as of (statement coverage or manual value date). */
  knownAsOf: IsoDate | null;
  price: AppliedPrice | null;
  fx: AppliedPrice | null;
  /** Value in AUD, or null when it cannot be calculated without fabricating a price or rate. */
  aud: DecimalString | null;
  status: ValueStatus;
  /** Why the value is stale, missing or untracked. */
  notes: string[];
}

export interface NetWorthPoint {
  on: IsoDate;
  assets: DecimalString;
  liabilities: DecimalString;
  netWorth: DecimalString;
  /** Some account could not be valued, or had money before its tracking began. */
  partial: boolean;
  /** Some value relies on a stale price, rate or carried-forward balance. */
  stale: boolean;
  accounts: AccountValue[];
}

const AUD_RATE: AppliedPrice = { on: '0000-01-01', price: '1', priceType: 'daily', stale: false, tradePriced: false };
const daysBetween = (a: IsoDate, b: IsoDate) => (Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000;

/** Values one account at a date, following the PRD's no-fabrication rules. */
export function valueAccount(
  account: AccountValuationInput,
  on: IsoDate,
  prices: ReadonlyMap<string, readonly PriceObservationInput[]>,
  fxRates: ReadonlyMap<string, readonly PriceObservationInput[]>,
): AccountValue {
  const base = {
    id: account.id,
    name: account.name,
    classification: account.classification,
    kind: account.kind,
    currency: account.currency,
  };
  const notes: string[] = [];
  let quantity: DecimalString | null;
  let knownAsOf: IsoDate | null;

  if (account.manualValues) {
    const latest = [...account.manualValues].filter((v) => v.on <= on).sort((a, b) => b.on.localeCompare(a.on))[0];
    quantity = latest?.quantity ?? null;
    knownAsOf = latest?.on ?? null;
  } else if (!account.opening || on < account.opening.on) {
    quantity = null;
    knownAsOf = null;
  } else {
    quantity = unitsAt(unitsSeries(account.opening, account.movements), on);
    knownAsOf = account.coverageEnd && account.coverageEnd < on ? account.coverageEnd : on;
  }

  if (quantity === null) {
    // Before tracking began: harmless if the account opened empty, otherwise its value is unknown.
    const hadMoney = !account.manualValues && account.opening && !isZero(account.opening.quantity);
    if (hadMoney) notes.push(`Tracking starts ${account.opening!.on}; earlier balance unknown`);
    return { ...base, quantity: null, knownAsOf: null, price: null, fx: null, aud: null, status: hadMoney ? 'untracked' : 'ok', notes };
  }

  let status: ValueStatus = 'ok';
  if (knownAsOf && daysBetween(knownAsOf, on) > BALANCE_STALE_DAYS) {
    status = 'stale';
    notes.push(`Balance last known ${knownAsOf}`);
  }

  // A zero holding needs no price or rate.
  if (isZero(quantity)) return { ...base, quantity, knownAsOf, price: null, fx: null, aud: '0', status, notes };

  let native = quantity;
  let price: AppliedPrice | null = null;
  if (account.kind === 'instrument') {
    price = priceAt(prices.get(account.instrumentId ?? '') ?? [], on);
    if (!price) return { ...base, quantity, knownAsOf, price: null, fx: null, aud: null, status: 'missing', notes: [...notes, 'No price'] };
    if (price.stale) {
      status = 'stale';
      notes.push(`Price from ${price.on}`);
    }
    native = mul(quantity, price.price);
  }

  const fx = account.currency === REPORTING_CURRENCY ? AUD_RATE : priceAt(fxRates.get(account.currency) ?? [], on);
  if (!fx)
    return {
      ...base,
      quantity,
      knownAsOf,
      price,
      fx: null,
      aud: null,
      status: 'missing',
      notes: [...notes, `No ${account.currency} rate`],
    };
  if (fx.stale) {
    status = 'stale';
    notes.push(`${account.currency} rate from ${fx.on}`);
  }
  return {
    ...base,
    quantity,
    knownAsOf,
    price,
    fx: account.currency === REPORTING_CURRENCY ? null : fx,
    aud: mul(native, fx.price),
    status,
    notes,
  };
}

/** Assets, liabilities and net worth in AUD at a date, with completeness flags. */
export function netWorthAt(
  accounts: readonly AccountValuationInput[],
  on: IsoDate,
  prices: ReadonlyMap<string, readonly PriceObservationInput[]>,
  fxRates: ReadonlyMap<string, readonly PriceObservationInput[]>,
): NetWorthPoint {
  const values = accounts.map((a) => valueAccount(a, on, prices, fxRates));
  const assets = add('0', ...values.filter((v) => v.classification === 'asset' && v.aud).map((v) => v.aud!));
  // Liability balances are negative (owed); report the amount owed as a positive number.
  const liabilities = neg(add('0', ...values.filter((v) => v.classification === 'liability' && v.aud).map((v) => v.aud!)));
  return {
    on,
    assets,
    liabilities,
    netWorth: add(assets, neg(liabilities)),
    partial: values.some((v) => v.status === 'missing' || v.status === 'untracked'),
    stale: values.some((v) => v.status === 'stale'),
    accounts: values,
  };
}
