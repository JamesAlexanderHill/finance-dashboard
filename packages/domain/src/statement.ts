import type { DecimalString, IsoDate } from '@finance/shared';

export type AccountType = 'bank' | 'credit_card' | 'investment' | 'brokerage' | 'payment_processor' | 'loan' | 'other';
export type AccountClassification = 'asset' | 'liability';

/** One posted row as read from a statement, before routing to a financial account. */
export interface ParsedRow {
  /** Position of the row within the whole file (unique across account sections); stable across re-parses. */
  rowIndex: number;
  postedOn: IsoDate;
  description: string;
  /** Signed from the owner's perspective: money in is positive. */
  amount: DecimalString;
  runningBalance?: DecimalString;
  /** Stable provider ID for this row; preferred over fingerprints for matching across files. */
  providerId?: string;
  /** Provider reference shared by rows of one activity (namespaced, e.g. `wise:BALANCE-1`); groups them into one event. */
  groupRef?: string;
  /** `fee` when the source reports the row as a fee for another row. Defaults to `principal`. */
  role?: 'principal' | 'fee';
  /** The source says this row moves money between the owner's accounts (e.g. a top-up). */
  transferHint?: boolean;
  raw: Record<string, unknown>;
}

/** A financial account section of a statement. One statement may contain several (ADR 0010). */
export interface ParsedAccountSection {
  identifier: string;
  maskedIdentifier: string;
  name: string;
  accountType: AccountType;
  classification: AccountClassification;
  commodity: string;
  openingBalance?: { on: IsoDate; balance: DecimalString };
  closingBalance?: { on: IsoDate; balance: DecimalString };
  rows: ParsedRow[];
}

export interface ParsedStatement {
  parserId: string;
  parserVersion: string;
  /** Institution provider key, e.g. `commbank`. */
  provider: string;
  institutionName: string;
  periodStart: IsoDate;
  periodEnd: IsoDate;
  accounts: ParsedAccountSection[];
  warnings: string[];
}

export class UnsupportedStatementError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsupportedStatementError';
  }
}
