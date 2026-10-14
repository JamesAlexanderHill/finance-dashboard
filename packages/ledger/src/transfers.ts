import { neg, normalise, type DecimalString, type IsoDate } from '@finance/shared';

/** A transaction that may be one half of a transfer. */
export interface TransferCandidate {
  id: string;
  accountId: string;
  postedOn: IsoDate;
  amount: DecimalString;
  commodity: string;
  /** When a payment reference states the other side's posting date, only a transaction posted that day can match. */
  counterpartDate?: IsoDate | null;
}

export const TRANSFER_WINDOW_DAYS = 5;

const dayNumber = (iso: IsoDate) => Date.parse(`${iso}T00:00:00Z`) / 86_400_000;

/**
 * For each transaction, the other transactions that could be its counterpart: a different owned
 * account, the same commodity, the exactly opposite amount, within ±5 calendar days, and consistent
 * with either side's stated counterpart date.
 */
export function transferCounterparts(txns: readonly TransferCandidate[]): Map<string, TransferCandidate[]> {
  const byKey = new Map<string, TransferCandidate[]>();
  const key = (commodity: string, amount: DecimalString) => `${commodity}|${normalise(amount)}`;
  for (const t of txns) byKey.set(key(t.commodity, t.amount), [...(byKey.get(key(t.commodity, t.amount)) ?? []), t]);

  const result = new Map<string, TransferCandidate[]>();
  for (const t of txns) {
    const opposite = byKey.get(key(t.commodity, neg(t.amount))) ?? [];
    const matches = opposite.filter(
      (o) =>
        o.accountId !== t.accountId &&
        Math.abs(dayNumber(o.postedOn) - dayNumber(t.postedOn)) <= TRANSFER_WINDOW_DAYS &&
        (!t.counterpartDate || t.counterpartDate === o.postedOn) &&
        (!o.counterpartDate || o.counterpartDate === t.postedOn),
    );
    if (matches.length) result.set(t.id, matches);
  }
  return result;
}

export interface TransferMatchPlan {
  /** Pairs to link automatically: each side has exactly one candidate, and it is the other. */
  pairs: Array<[TransferCandidate, TransferCandidate]>;
  /** Transactions with candidates that could not be matched automatically, for review. */
  ambiguous: Map<string, TransferCandidate[]>;
}

/** Applies the auto-match rule; anything that is not a unique mutual match goes to review. */
export function planTransferMatches(txns: readonly TransferCandidate[]): TransferMatchPlan {
  const counterparts = transferCounterparts(txns);
  const pairs: TransferMatchPlan['pairs'] = [];
  const ambiguous = new Map<string, TransferCandidate[]>();
  const paired = new Set<string>();

  for (const t of txns) {
    const mine = counterparts.get(t.id);
    if (!mine) continue;
    const only = mine.length === 1 ? mine[0]! : null;
    const theirs = only ? counterparts.get(only.id) : undefined;
    if (only && theirs?.length === 1 && theirs[0]!.id === t.id) {
      if (!paired.has(t.id) && !paired.has(only.id) && t.amount.startsWith('-')) {
        pairs.push([t, only]);
        paired.add(t.id).add(only.id);
      }
      continue;
    }
    ambiguous.set(t.id, mine);
  }
  return { pairs, ambiguous };
}
