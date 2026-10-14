import { normalise, sha256Hex, type DecimalString, type IsoDate } from '@finance/shared';

/** Upper-case, alphanumerics only, single spaces. Used for cross-file matching. */
export function normaliseDescription(description: string): string {
  return description
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export interface FingerprintInput {
  accountId: string;
  postedOn: IsoDate;
  amount: DecimalString;
  description: string;
}

/** Key shared by identical rows; rows with the same key are told apart by ordinal. */
export function identityKey(row: FingerprintInput): string {
  return [row.accountId, row.postedOn, normalise(row.amount), normaliseDescription(row.description)].join('|');
}

/**
 * Fingerprint for rows without a provider ID:
 * (account, posted date, amount, normalised description, ordinal among identical rows in the file).
 */
export function fingerprint(row: FingerprintInput, ordinal: number): string {
  return sha256Hex(`${identityKey(row)}|${ordinal}`);
}

/** Assigns each row its ordinal among identical rows in the same file, in file order. */
export function withOrdinals<T extends FingerprintInput>(rows: readonly T[]): Array<T & { ordinal: number; fingerprint: string }> {
  const seen = new Map<string, number>();
  return rows.map((row) => {
    const key = identityKey(row);
    const ordinal = seen.get(key) ?? 0;
    seen.set(key, ordinal + 1);
    return { ...row, ordinal, fingerprint: fingerprint(row, ordinal) };
  });
}
