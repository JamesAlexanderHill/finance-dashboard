import { sql } from 'drizzle-orm';
import {
  bigint,
  bigserial,
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { user } from './auth';

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
/** Exact decimal; never floats. Drizzle returns these as strings. */
const amount = (name: string) => numeric(name, { precision: 24, scale: 8 });

// ---------------------------------------------------------------- ownership

export const workspaceRole = pgEnum('workspace_role', ['owner']);

export const workspaces = pgTable('workspaces', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  createdAt: createdAt(),
});

export const workspaceMembers = pgTable(
  'workspace_members',
  {
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    userId: text('user_id')
      .notNull()
      .references(() => user.id),
    role: workspaceRole('role').notNull().default('owner'),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.workspaceId, t.userId] }), index('workspace_members_user_idx').on(t.userId)],
);

// ---------------------------------------------------------------- institutions and accounts

export const accountType = pgEnum('account_type', ['bank', 'credit_card', 'investment', 'brokerage', 'payment_processor', 'loan', 'other']);
export const accountClassification = pgEnum('account_classification', ['asset', 'liability']);
export const commodityKind = pgEnum('commodity_kind', ['currency', 'instrument']);
export const accountStatus = pgEnum('account_status', ['confirmed', 'unconfirmed']);

export const institutions = pgTable(
  'institutions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    name: text('name').notNull(),
    /** Parser family, e.g. `commbank`, or `manual`. */
    provider: text('provider').notNull(),
    createdAt: createdAt(),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
  },
  (t) => [uniqueIndex('institutions_workspace_name_uq').on(t.workspaceId, t.name)],
);

export const financialAccounts = pgTable(
  'financial_accounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    institutionId: uuid('institution_id')
      .notNull()
      .references(() => institutions.id),
    name: text('name').notNull(),
    accountType: accountType('account_type').notNull(),
    classification: accountClassification('classification').notNull(),
    commodityKind: commodityKind('commodity_kind').notNull().default('currency'),
    /** ISO currency code or instrument symbol; one commodity per account (ADR 0011). */
    commodity: text('commodity').notNull(),
    /** Set for holding accounts: the shared instrument this account holds (ADR 0011). */
    instrumentId: uuid('instrument_id').references(() => instruments.id),
    /** Provider identifier used to route source rows (e.g. BSB + account number). */
    identifier: text('identifier').notNull(),
    maskedIdentifier: text('masked_identifier').notNull(),
    status: accountStatus('status').notNull().default('confirmed'),
    createdAt: createdAt(),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('financial_accounts_identifier_uq').on(t.institutionId, t.identifier),
    index('financial_accounts_workspace_idx').on(t.workspaceId),
  ],
);

export const balanceSource = pgEnum('balance_source', ['statement', 'manual']);
export const balanceKind = pgEnum('balance_kind', ['opening', 'closing', 'point']);

export const balanceObservations = pgTable(
  'balance_observations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    accountId: uuid('account_id')
      .notNull()
      .references(() => financialAccounts.id),
    observedOn: date('observed_on').notNull(),
    kind: balanceKind('kind').notNull(),
    /** Signed from the owner's perspective: liabilities are negative. */
    balance: amount('balance').notNull(),
    source: balanceSource('source').notNull(),
    sourceFileId: uuid('source_file_id').references(() => sourceFiles.id),
    createdAt: createdAt(),
  },
  (t) => [index('balance_observations_account_idx').on(t.accountId, t.observedOn)],
);

// ---------------------------------------------------------------- instruments and prices

/** A security shared by every account that holds it; prices are stored once per instrument. */
export const instruments = pgTable(
  'instruments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    symbol: text('symbol').notNull(),
    /** ISO 10383 market identifier, e.g. `XASX`. Same symbol on different exchanges is a different instrument. */
    exchange: text('exchange').notNull(),
    name: text('name').notNull(),
    /** Currency the instrument is priced in. */
    currency: text('currency').notNull(),
    isin: text('isin'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('instruments_symbol_uq').on(t.workspaceId, t.exchange, t.symbol)],
);

/** Other names an instrument goes by in imports (e.g. `VAS.AX` in a price CSV). */
export const instrumentAliases = pgTable(
  'instrument_aliases',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    instrumentId: uuid('instrument_id')
      .notNull()
      .references(() => instruments.id),
    alias: text('alias').notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('instrument_aliases_uq').on(t.workspaceId, t.alias)],
);

export const priceType = pgEnum('price_type', ['daily', 'trade', 'manual']);
export const priceSource = pgEnum('price_source', ['statement', 'csv', 'manual']);
/** `conflict` marks observations that disagree for the same instrument/date/currency/type until the user picks one. */
export const priceStatus = pgEnum('price_status', ['active', 'conflict', 'rejected']);

export const priceObservations = pgTable(
  'price_observations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    instrumentId: uuid('instrument_id')
      .notNull()
      .references(() => instruments.id),
    observedOn: date('observed_on').notNull(),
    price: amount('price').notNull(),
    currency: text('currency').notNull(),
    priceType: priceType('price_type').notNull(),
    source: priceSource('source').notNull(),
    /** Provenance; observations from a soft-deleted file drop out of active use. */
    sourceFileId: uuid('source_file_id').references(() => sourceFiles.id),
    /** Row within the source file (CSV line or statement row), when known. */
    sourceRow: integer('source_row'),
    status: priceStatus('status').notNull().default('active'),
    createdBy: text('created_by').references(() => user.id),
    createdAt: createdAt(),
  },
  (t) => [
    index('price_observations_instrument_idx').on(t.instrumentId, t.observedOn),
    index('price_observations_file_idx').on(t.sourceFileId),
  ],
);

// ---------------------------------------------------------------- source files

export const sourceFileKind = pgEnum('source_file_kind', ['statement', 'price_import', 'receipt']);

/** Retained uploaded binaries. `deletedAt` is the file's lifecycle state only. */
export const sourceFiles = pgTable(
  'source_files',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    kind: sourceFileKind('kind').notNull(),
    originalName: text('original_name').notNull(),
    contentType: text('content_type').notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    checksumSha256: text('checksum_sha256').notNull(),
    objectKey: text('object_key').notNull(),
    uploadedBy: text('uploaded_by').references(() => user.id),
    uploadedAt: timestamp('uploaded_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    deletedBy: text('deleted_by').references(() => user.id),
  },
  (t) => [index('source_files_workspace_idx').on(t.workspaceId, t.uploadedAt)],
);

export const statementStatus = pgEnum('statement_status', [
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
]);

export const statements = pgTable(
  'statements',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    sourceFileId: uuid('source_file_id')
      .notNull()
      .references(() => sourceFiles.id)
      .unique(),
    institutionId: uuid('institution_id').references(() => institutions.id),
    status: statementStatus('status').notNull().default('uploaded'),
    parserId: text('parser_id'),
    parserVersion: text('parser_version'),
    periodStart: date('period_start'),
    periodEnd: date('period_end'),
    error: text('error'),
    createdAt: createdAt(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (t) => [index('statements_workspace_idx').on(t.workspaceId)],
);

/** One parsed row of a source file. Rows are never merged with each other. */
export const sourceRecords = pgTable(
  'source_records',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    sourceFileId: uuid('source_file_id')
      .notNull()
      .references(() => sourceFiles.id),
    rowIndex: integer('row_index').notNull(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => financialAccounts.id),
    postedOn: date('posted_on').notNull(),
    description: text('description').notNull(),
    amount: amount('amount').notNull(),
    runningBalance: amount('running_balance'),
    /** Ordinal among identical (account, date, amount, description) rows in this file. */
    ordinal: integer('ordinal').notNull(),
    fingerprint: text('fingerprint').notNull(),
    raw: jsonb('raw').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('source_records_file_row_uq').on(t.sourceFileId, t.rowIndex),
    index('source_records_fingerprint_idx').on(t.workspaceId, t.fingerprint),
  ],
);

// ---------------------------------------------------------------- canonical transactions

/** What a transaction's leg is for, as stated by its source (e.g. a Wise fee row). */
export const transactionRole = pgEnum('transaction_role', ['principal', 'fee']);

export const transactions = pgTable(
  'transactions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    accountId: uuid('account_id')
      .notNull()
      .references(() => financialAccounts.id),
    postedOn: date('posted_on').notNull(),
    description: text('description').notNull(),
    amount: amount('amount').notNull(),
    commodity: text('commodity').notNull(),
    providerId: text('provider_id'),
    /**
     * Provider reference shared by rows of one economic activity (e.g. a Wise conversion's two currency
     * rows and its fee row). Namespaced by provider, e.g. `wise:BALANCE-123`. Groups them into one event.
     */
    providerGroupRef: text('provider_group_ref'),
    role: transactionRole('role').notNull().default('principal'),
    /** The source says this is money moved between own accounts (e.g. a Wise top-up). */
    isTransferHint: boolean('is_transfer_hint').notNull().default(false),
    /** The date the other side of a transfer was posted, when a payment reference states it (e.g. a BPAY receipt). */
    counterpartDate: date('counterpart_date'),
    fingerprint: text('fingerprint').notNull(),
    /** Derived: has at least one source row in a non-deleted source file. */
    isSourceSupported: boolean('is_source_supported').notNull().default(true),
    /** Derived from the latest suppression decision. Distinct from source support. */
    isSuppressed: boolean('is_suppressed').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('transactions_fingerprint_uq').on(t.workspaceId, t.fingerprint),
    index('transactions_account_date_idx').on(t.accountId, t.postedOn),
    index('transactions_workspace_date_idx').on(t.workspaceId, t.postedOn),
    index('transactions_group_ref_idx').on(t.workspaceId, t.providerGroupRef),
  ],
);

export const transactionSources = pgTable(
  'transaction_sources',
  {
    transactionId: uuid('transaction_id')
      .notNull()
      .references(() => transactions.id),
    sourceRecordId: uuid('source_record_id')
      .notNull()
      .references(() => sourceRecords.id)
      .unique(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.transactionId, t.sourceRecordId] })],
);

// ---------------------------------------------------------------- reconciliation decisions

export const decisionKind = pgEnum('decision_kind', ['category', 'tags', 'suppression', 'itemisation', 'link', 'transfer']);
export const decisionActor = pgEnum('decision_actor', ['user', 'system']);

/**
 * Append-only. The current decision for (transaction, kind, legKey) is the one with the
 * highest `seq`; a change or undo is a new row that supersedes the previous one.
 */
export const reconciliationDecisions = pgTable(
  'reconciliation_decisions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    seq: bigserial('seq', { mode: 'number' }).notNull().unique(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    transactionId: uuid('transaction_id')
      .notNull()
      .references(() => transactions.id),
    kind: decisionKind('kind').notNull(),
    /** Leg identity within the transaction: `principal` or `line:<index>`; empty for whole-transaction decisions. */
    legKey: text('leg_key').notNull().default(''),
    payload: jsonb('payload').notNull(),
    supersedesId: uuid('supersedes_id'),
    actor: decisionActor('actor').notNull().default('user'),
    createdBy: text('created_by').references(() => user.id),
    createdAt: createdAt(),
  },
  (t) => [index('decisions_transaction_idx').on(t.transactionId, t.kind, t.legKey, t.seq)],
);

// ---------------------------------------------------------------- categories and tags

export const categoryKind = pgEnum('category_kind', ['income', 'expense']);

export const categories = pgTable(
  'categories',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    parentId: uuid('parent_id'),
    name: text('name').notNull(),
    kind: categoryKind('kind').notNull(),
    /** Fixed top-level categories: Income, Savings, Essentials, Lifestyle. */
    isFixed: boolean('is_fixed').notNull().default(false),
    sortOrder: integer('sort_order').notNull().default(0),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index('categories_workspace_idx').on(t.workspaceId, t.parentId)],
);

export const tags = pgTable(
  'tags',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    name: text('name').notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('tags_workspace_name_uq').on(t.workspaceId, t.name)],
);

// ---------------------------------------------------------------- events (pure projection)

export const eventType = pgEnum('event_type', [
  'income',
  'expense',
  'internal_transfer',
  'currency_conversion',
  'investment_buy',
  'investment_sell',
  'distribution',
  'interest',
  'fee',
  'refund',
  'adjustment',
  'opening_balance',
  'unknown',
]);
export const eventStatus = pgEnum('event_status', ['ok', 'unmatched_transfer', 'needs_review']);
export const legRole = pgEnum('leg_role', ['principal', 'fee', 'tax', 'interest', 'line_item']);

/** Rebuilt from active transactions + decisions; IDs are deterministic. Safe to drop and rebuild. */
export const events = pgTable(
  'events',
  {
    id: uuid('id').primaryKey(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    type: eventType('type').notNull(),
    status: eventStatus('status').notNull().default('ok'),
    occurredOn: date('occurred_on').notNull(),
    description: text('description').notNull(),
    /** Internal events move value between owned accounts; only fee/tax/interest legs leave net worth. */
    isInternal: boolean('is_internal').notNull().default(false),
    governingDecisionId: uuid('governing_decision_id'),
  },
  (t) => [index('events_workspace_date_idx').on(t.workspaceId, t.occurredOn)],
);

export const eventLegs = pgTable(
  'event_legs',
  {
    id: uuid('id').primaryKey(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    accountId: uuid('account_id')
      .notNull()
      .references(() => financialAccounts.id),
    transactionId: uuid('transaction_id').references(() => transactions.id),
    role: legRole('role').notNull(),
    /** Stable leg identity within its transaction (`principal`, `line:0`, …); categories are keyed on it. */
    legKey: text('leg_key').notNull(),
    occurredOn: date('occurred_on').notNull(),
    description: text('description').notNull(),
    amount: amount('amount').notNull(),
    commodity: text('commodity').notNull(),
    categoryId: uuid('category_id'),
    tagIds: uuid('tag_ids')
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
  },
  (t) => [
    index('event_legs_event_idx').on(t.eventId),
    index('event_legs_workspace_date_idx').on(t.workspaceId, t.occurredOn),
    index('event_legs_transaction_idx').on(t.transactionId),
  ],
);

export const eventTransactionLinks = pgTable(
  'event_transaction_links',
  {
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    transactionId: uuid('transaction_id')
      .notNull()
      .references(() => transactions.id),
  },
  (t) => [primaryKey({ columns: [t.eventId, t.transactionId] })],
);

// ---------------------------------------------------------------- jobs

export const jobStatus = pgEnum('job_status', ['queued', 'running', 'completed', 'failed']);

export const jobs = pgTable(
  'jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    type: text('type').notNull(),
    payload: jsonb('payload').notNull(),
    status: jobStatus('status').notNull().default('queued'),
    idempotencyKey: text('idempotency_key').notNull(),
    attempts: integer('attempts').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(5),
    runAfter: timestamp('run_after', { withTimezone: true }).notNull().defaultNow(),
    lockedBy: text('locked_by'),
    leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true }),
    heartbeatAt: timestamp('heartbeat_at', { withTimezone: true }),
    progress: jsonb('progress'),
    lastError: text('last_error'),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (t) => [uniqueIndex('jobs_idempotency_uq').on(t.workspaceId, t.idempotencyKey), index('jobs_claim_idx').on(t.status, t.runAfter)],
);

/** Append-only, monotonically increasing job progress records; the SSE stream replays from these. */
export const jobProgress = pgTable(
  'job_progress',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    jobId: uuid('job_id')
      .notNull()
      .references(() => jobs.id),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    stage: text('stage').notNull(),
    message: text('message'),
    data: jsonb('data'),
    createdAt: createdAt(),
  },
  (t) => [index('job_progress_job_idx').on(t.jobId, t.id), index('job_progress_workspace_idx').on(t.workspaceId, t.id)],
);

export const importResults = pgTable('import_results', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id')
    .notNull()
    .references(() => workspaces.id),
  /** Set for statement imports. */
  statementId: uuid('statement_id').references(() => statements.id),
  /** The imported file (statement or price import). */
  sourceFileId: uuid('source_file_id').references(() => sourceFiles.id),
  jobId: uuid('job_id').references(() => jobs.id),
  summary: jsonb('summary').notNull(),
  createdAt: createdAt(),
});
