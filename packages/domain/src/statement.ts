import type { DecimalString, IsoDate } from '@finance/shared';

export type AccountType = 'bank' | 'credit_card' | 'investment' | 'brokerage' | 'payment_processor' | 'loan' | 'other';
export type AccountClassification = 'asset' | 'liability';

/** One posted row as read from a statement, before routing to a financial account. */
export interface ParsedRow {
  /** Position of the row within the file; stable across re-parses of the same file. */
  rowIndex: number;
  postedOn: IsoDate;
  description: string;
  /** Signed from the owner's perspective: money in is positive. */
  amount: DecimalString;
  runningBalance?: DecimalString;
  providerId?: string;
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
