export type ParsedEventType =
  | "purchase"
  | "transfer"
  | "exchange"
  | "trade"
  | "bill_payment"
  | "payout";

export interface ParsedLeg {
  /** Instrument code e.g. "AUD", "VDAL". Resolved to ID by the import runner. */
  instrumentCode: string;
  /** Raw decimal string e.g. "-855.00" or "19". Import runner applies minorUnit. */
  amountDecimal: string;
}

export interface ParsedRow {
  externalId?: string;
  effectiveAt: Date;
  postedAt?: Date;
  description: string;
  eventType: ParsedEventType;
  legs: ParsedLeg[];
  meta?: Record<string, unknown>;
}

export interface ParseResult {
  rows: ParsedRow[];
  errors: Array<{ line: number; message: string }>;
}
