/** Browser-safe account rules (imported as `@finance/domain/accounts`). */

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
