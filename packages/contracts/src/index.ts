import { z } from 'zod';

// ---------------------------------------------------------------- jobs

export const JOB_TYPES = { statementImport: 'statement.import', priceImport: 'price.import' } as const;

export const statementImportPayload = z.object({ statementId: z.uuid() });
export type StatementImportPayload = z.infer<typeof statementImportPayload>;

export const priceCsvMapping = z
  .object({
    dateColumn: z.string().min(1),
    dateFormat: z.enum(['YYYY-MM-DD', 'DD/MM/YYYY', 'MM/DD/YYYY']),
    priceColumn: z.string().min(1),
    instrumentId: z.uuid().optional(),
    instrumentColumn: z.string().min(1).optional(),
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .optional(),
    currencyColumn: z.string().min(1).optional(),
  })
  .refine((m) => !!m.instrumentId !== !!m.instrumentColumn, 'Choose either one instrument or an instrument column');
export type PriceCsvMappingInput = z.infer<typeof priceCsvMapping>;

export const priceImportPayload = z.object({ sourceFileId: z.uuid(), mapping: priceCsvMapping, mappingVersion: z.string() });
export type PriceImportPayload = z.infer<typeof priceImportPayload>;

export interface PriceImportSummary {
  rows: number;
  inserted: number;
  duplicates: number;
  conflicts: number;
  /** Rejected rows (first 200), each with its 1-based line number. */
  errors: Array<{ line: number; error: string }>;
  errorCount: number;
  mappingVersion: string;
}

export const startPriceImportInput = z.object({ sourceFileId: z.uuid(), mapping: priceCsvMapping });
export const manualPriceInput = z.object({
  instrumentId: z.uuid(),
  observedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  price: z.string().regex(/^\d+(\.\d+)?$/, 'Must be a positive number'),
});
export const setOverrideInput = z.object({
  instrumentId: z.uuid(),
  price: z.string().regex(/^\d+(\.\d+)?$/, 'Must be a positive number'),
});
export const resolvePriceConflictInput = z.object({ observationId: z.uuid() });
export const instrumentAliasInput = z.object({ instrumentId: z.uuid(), alias: z.string().trim().min(1).max(64) });
export const unresolvedInstrumentsInput = z.object({ sourceFileId: z.uuid(), column: z.string().min(1) });

export const STATEMENT_STAGES = [
  'uploaded',
  'queued',
  'parsing',
  'normalising',
  'staging',
  'reconciling',
  'posting-events',
  'completed',
  'partial',
  'failed',
] as const;
export type StatementStage = (typeof STATEMENT_STAGES)[number];
export const TERMINAL_STAGES: ReadonlyArray<StatementStage> = ['completed', 'partial', 'failed'];

/** A durable job progress record as streamed over SSE (the SSE `id` is `id`). */
export const jobProgressRecord = z.object({
  id: z.number(),
  jobId: z.uuid(),
  stage: z.string(),
  message: z.string().nullable(),
  data: z.unknown().nullable(),
  createdAt: z.string(),
});
export type JobProgressRecord = z.infer<typeof jobProgressRecord>;

export interface ImportSummary {
  rows: number;
  created: number;
  linked: number;
  restored: number;
  /** Transfer pairs linked automatically by this import. */
  transfersMatched: number;
  /** Price observations recorded from the statement (closing and trade prices). */
  prices: number;
  accounts: Array<{ id: string; name: string; created: boolean }>;
  warnings: string[];
}

// ---------------------------------------------------------------- API inputs

const decimal = z.string().regex(/^-?\d+(\.\d+)?$/, 'Must be a decimal number');
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD');
const legKey = z.string().regex(/^(principal|fee|line:\d+)$/);

export const idInput = z.object({ id: z.uuid() });

export const setCategoryInput = z.object({ transactionId: z.uuid(), legKey, categoryId: z.uuid().nullable() });
const legRefs = z
  .array(z.object({ transactionId: z.uuid(), legKey }))
  .min(1)
  .max(500);
/** One category for many legs at once (a manual bulk action, not a rule). */
export const setCategoryForLegsInput = z.object({ legs: legRefs, categoryId: z.uuid().nullable() });
/** Accepts the current category suggestions for these legs. */
export const acceptSuggestionsInput = z.object({ legs: legRefs });
export const setTagsInput = z.object({ transactionId: z.uuid(), legKey, tagNames: z.array(z.string().trim().min(1).max(60)).max(20) });
export const linkTransactionsInput = z.object({ transactionIds: z.array(z.uuid()).min(2).max(20) });
export const unlinkTransactionInput = z.object({ transactionId: z.uuid() });
export const setTransferMarkInput = z.object({ transactionId: z.uuid(), isTransfer: z.boolean() });
export const setSuppressionInput = z.object({ transactionId: z.uuid(), suppressed: z.boolean() });
export const setReceiptRemovedInput = z.object({ sourceFileId: z.uuid(), removed: z.boolean() });
export const itemiseInput = z.object({
  transactionId: z.uuid(),
  lines: z
    .array(z.object({ amount: decimal, description: z.string().max(200) }))
    .min(2)
    .nullable(),
});

export const createCategoryInput = z.object({ parentId: z.uuid(), name: z.string().trim().min(1).max(80) });
export const renameCategoryInput = z.object({ id: z.uuid(), name: z.string().trim().min(1).max(80) });
export const deleteCategoryInput = z.object({ id: z.uuid(), reassignTo: z.uuid() });

export const updateAccountInput = z.object({
  id: z.uuid(),
  name: z.string().trim().min(1).max(80).optional(),
  confirm: z.boolean().optional(),
});

/** Merges an unconfirmed account into another account of the same institution and commodity. */
export const mergeAccountInput = z.object({ id: z.uuid(), intoId: z.uuid() });

export const createManualAccountInput = z.object({
  name: z.string().trim().min(1).max(80),
  classification: z.enum(['asset', 'liability']),
  currency: z.string().regex(/^[A-Z]{3}$/),
});
/** A manual account's value; always entered as a positive amount (liabilities are stored negative). */
export const recordManualBalanceInput = z.object({
  accountId: z.uuid(),
  observedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  amount: z.string().regex(/^\d+(\.\d{1,2})?$/, 'Enter a positive amount'),
});

export const transactionFilter = z.object({
  id: z.uuid().optional(),
  accountId: z.uuid().optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  status: z.enum(['active', 'inactive', 'all']).default('active'),
  uncategorisedOnly: z.boolean().default(false),
  search: z.string().max(100).optional(),
  limit: z.number().int().min(1).max(500).default(200),
  offset: z.number().int().min(0).default(0),
});
export type TransactionFilter = z.infer<typeof transactionFilter>;

export const cashFlowQuery = z.object({
  from: isoDate,
  to: isoDate,
  tagIds: z.array(z.uuid()).default([]),
  focusId: z.uuid().nullable().default(null),
});
export type CashFlowQuery = z.infer<typeof cashFlowQuery>;

export const dashboardQuery = z.object({
  granularity: z.enum(['week', 'month', 'quarter', 'year', 'custom']).default('month'),
  /** Number of previous periods to compare against. */
  n: z.number().int().min(1).max(24).default(6),
  /** Any date in the selected period (default today); ignored for custom. */
  date: isoDate.optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  tagIds: z.array(z.uuid()).default([]),
  /** Expense category to drill into for the stacked expense bars. */
  expenseFocus: z.uuid().nullable().default(null),
});
export type DashboardQuery = z.infer<typeof dashboardQuery>;

export const legsQuery = z.object({
  from: isoDate,
  to: isoDate,
  tagIds: z.array(z.uuid()).default([]),
  /** A category ID, or `uncategorised-income` / `uncategorised-expense`. */
  node: z.string(),
});

export const ALLOWED_STATEMENT_TYPES = ['application/pdf', 'text/csv'] as const;
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
