/** Browser-safe account rules (imported as `@finance/domain/accounts`). */
import { addDays, type IsoDate } from '@finance/shared';

export interface TrackedAccountRef {
  id: string;
  name: string;
  institution: string;
  provider: string;
  classification: 'asset' | 'liability';
}

/** Words that carry no identity. */
const FILLER_WORDS = new Set(['account', 'accounts', 'manual', 'the', 'my', 'and', 'of']);
/** Words that name a kind of account rather than a particular one. */
const TYPE_WORDS = new Set(['bank', 'card', 'cash', 'credit', 'home', 'investment', 'investments', 'loan', 'savings']);

const words = (text: string) => text.toLowerCase().match(/[a-z0-9]+/g) ?? [];

/**
 * Tracked accounts a new manual account may duplicate (feature 12): same classification, and a
 * distinctive word of its name appears in the tracked account's name, institution or provider. A
 * name with no distinctive word (e.g. "Home loan") matches on any of its account-type words instead.
 * A warning only; the user decides.
 */
export function possibleDuplicates<T extends TrackedAccountRef>(
  candidate: { name: string; classification: 'asset' | 'liability' },
  tracked: readonly T[],
): T[] {
  const own = words(candidate.name).filter((w) => !FILLER_WORDS.has(w));
  const distinctive = own.filter((w) => !TYPE_WORDS.has(w));
  const keys = distinctive.length > 0 ? distinctive : own;
  if (keys.length === 0) return [];
  return tracked.filter((a) => {
    if (a.provider === 'manual' || a.classification !== candidate.classification) return false;
    const theirs = new Set([...words(a.name), ...words(a.institution), ...words(a.provider)]);
    return keys.some((w) => theirs.has(w));
  });
}

/** An inclusive range of calendar dates, such as a statement's period. */
export interface Period {
  start: IsoDate;
  end: IsoDate;
}

/**
 * What an account's statements cover (feature 02): their periods merged where they overlap or run on
 * from each other (one ends the day before the next starts), and the gaps between the merged periods.
 */
export function statementCoverage(periods: readonly Period[]): { covered: Period[]; gaps: Period[] } {
  const covered: Period[] = [];
  for (const p of [...periods].sort((a, b) => a.start.localeCompare(b.start))) {
    const last = covered.at(-1);
    if (last && p.start <= addDays(last.end, 1)) {
      if (p.end > last.end) last.end = p.end;
    } else covered.push({ start: p.start, end: p.end });
  }
  const gaps = covered.slice(1).map((p, i) => ({ start: addDays(covered[i]!.end, 1), end: addDays(p.start, -1) }));
  return { covered, gaps };
}
