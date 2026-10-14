/**
 * Plans how a file's rows attach to canonical transactions (ADR 0003).
 * Rows carry a fingerprint that already includes their ordinal among identical rows in the file,
 * so one file can never link two rows to the same transaction.
 */
export interface RowToMatch {
  rowIndex: number;
  fingerprint: string;
}

export interface MatchPlan {
  /** Rows that attach to an existing transaction (active or not); attaching restores the original ID. */
  linked: Array<{ rowIndex: number; transactionId: string }>;
  /** Rows that need a new canonical transaction. */
  created: number[];
}

export function planMatches(rows: readonly RowToMatch[], existingByFingerprint: ReadonlyMap<string, string>): MatchPlan {
  const plan: MatchPlan = { linked: [], created: [] };
  const seen = new Set<string>();
  for (const row of rows) {
    if (seen.has(row.fingerprint)) throw new Error(`Duplicate fingerprint within one file at row ${row.rowIndex}`);
    seen.add(row.fingerprint);
    const existing = existingByFingerprint.get(row.fingerprint);
    if (existing) plan.linked.push({ rowIndex: row.rowIndex, transactionId: existing });
    else plan.created.push(row.rowIndex);
  }
  return plan;
}
