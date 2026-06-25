# Transactions

This document covers the full lifecycle of financial data in the app: how transactions are modeled (events and legs), how accounts and instruments are managed, and how data is imported from bank and broker exports.

## Events

An **event** is a single financial transaction. Every event belongs to one account and has one or more **legs** (see below). Events are never physically deleted — they are soft-deleted by setting `deletedAt`, preserving history and allowing re-import to restore them.

### Event Types

| Type | Description |
|------|-------------|
| `purchase` | Consumer spending (retail, restaurants, online) |
| `transfer` | Movement of funds between accounts |
| `exchange` | Currency conversion within a multi-currency account |
| `trade` | Investment transaction — buying or selling securities |
| `bill_payment` | Recurring or one-time bill (utilities, subscriptions, rent) |
| `payout` | Income — salary, bonus, dividend, distribution |

### Dates

Each event tracks two dates:

- **`effectiveAt`** — When the transaction actually occurred (the consumer-facing date).
- **`postedAt`** — When the transaction posted to the account (the financial settlement date). Usually the same as `effectiveAt` but can differ (e.g. a cheque clears two days after it is written).

Balance calculations use `effectiveAt`.

### Legs

A **leg** is one side of a transaction — a signed flow of a specific instrument. Most transactions have a single leg, but multi-leg events are supported:

| Scenario | Legs |
|----------|------|
| Salary deposit | 1 leg: +AUD |
| Currency exchange | 2 legs: −AUD, +USD |
| Share purchase | 2 legs: −AUD cash, +ETF units |
| Supermarket split | 3+ legs: one per spending category |

Each leg records:
- `instrumentId` — Which currency or asset moved
- `unitCount` — Signed amount in minor units (e.g. cents for AUD; whole numbers for shares). Negative = outflow, positive = inflow.
- `categoryId` — Optional category tag (see [Categories](./categories.md))
- `description` — Optional per-leg note

Legs can also be subdivided into **line items** for itemized splits within a single leg (e.g. a $127.50 supermarket leg split into $48.50 groceries + $52.00 produce + $27.00 dairy).

### Deduplication

Each event has a unique `dedupeKey` used to prevent duplicate imports:

- If the source provides a transaction ID: `dedupeKey = "{accountId}:{externalEventId}"`
- Otherwise: `dedupeKey = SHA256("{accountId}|{effectiveAt}|{amountMinorUnits}|{normalizedDescription}")`

During import, if a matching `dedupeKey` already exists the event is either skipped or restored (if it was previously soft-deleted and the user chose to restore).

### Event Drawer

Clicking any event row anywhere in the app opens the **event drawer** — a slide-in panel on the right side of the screen, controlled by the `viewEvent` search parameter on the current route. The drawer shows:

- **Details** — effective and posted dates, external ID (if any), and dedupe key.
- **Delete / Restore** — a toggle button that soft-deletes the event (sets `deletedAt`) or restores it (clears `deletedAt`). Deleted events display with a strikethrough title. Checkpoints and rates are recomputed immediately after the toggle.
- **Legs** — each leg is listed with its instrument ticker, signed amount, and a category selector. Changing the category updates `legs.categoryId` in place without affecting the event's other fields.
- **Line items** — each leg has an expandable line-item editor. Clicking "Items (N)" expands a panel where sub-splits can be added, edited, or removed. Each line item has an amount (in minor units), an optional category, and an optional description. The line-item total must equal the parent leg's `unitCount` before saving is allowed.

### Events Pages

Events can be browsed from two places:

- **`/events`** — a global cross-account list of all events in the workspace, with an account filter dropdown that narrows results to a single account. Pagination is controlled via `page` and `pageSize` search params.
- **`/accounts/$accountId/events`** — the same paginated table scoped to one account, accessible via the account detail page or breadcrumb navigation.

Both views open the event drawer when a row is clicked.

---

## Accounts

An **account** represents a financial institution or wallet (e.g. CommBank, Amex, Wise, Vanguard). Each account belongs to a workspace and holds one or more instruments.

### Account Settings

- **Name** — User-assigned label (e.g. "CommBank Everyday").
- **Color/hue** — One of eight base colors (blue, emerald, amber, rose, violet, cyan, orange, fuchsia), used for chart coloring. If unset, a color is auto-assigned by position.
- **Default instrument** — The primary currency or asset for the account. Used as the display default in the UI.

### Chart Coloring

Each account's base hue is divided into five shades (0–4) which are assigned to that account's instruments. This ensures visual continuity between an account and all the assets it holds across charts.

### Deletion

An account can only be deleted if it has no events. Attempting to delete an account with existing transactions returns an error.

---

## Instruments

An **instrument** is a currency or asset held within an account (e.g. AUD in a CommBank account, VHY shares in a Vanguard account). Instruments are account-scoped — the same ticker can exist independently in multiple accounts.

### Key Fields

| Field | Description |
|-------|-------------|
| `ticker` | Symbol code, uppercase (e.g. `AUD`, `USD`, `VHY`) |
| `name` | Human-readable name (e.g. "Australian Dollar") |
| `exponent` | Decimal places for display. Currencies: typically `2` (cents). Shares: typically `0` (whole units). |

### Balance Tracking

An instrument's current balance is calculated as:

```
balance = latest checkpoint balance + sum of all legs since checkpoint period end
```

Monthly **checkpoints** (`instrumentCheckpoints` table) store snapshots of each instrument's balance, avoiding a full ledger scan on every query. Balance history is available at day, week, or month granularity.

### Exchange Rates

Each instrument can have an exchange rate record (`instrumentRates`) expressing how many units of the user's home currency one unit of this instrument is worth. Rates are used to convert multi-currency balances for display in the dashboard's net worth card and stacked area chart.

Rates have a `source` field:
- `'manual'` — explicitly set by the user via the instrument detail page.
- `'transaction'` — inferred automatically from a trade event that exchanged the instrument against the home currency (e.g. a Vanguard buy where AUD and ETF units are both legs of the same event).

The instrument detail page (`/accounts/$accountId/instruments/$instrumentId`) shows the current value (balance × rate converted to home currency) and an "Update price" button that opens an inline form. Entering a new rate and saving writes a `'manual'` rate record with the current date as `asOf`. The `source` and `asOf` values are displayed beneath the current value.

Instruments whose ticker matches the user's `homeCurrencyCode` are treated as the home currency and do not show exchange rate UI.

### Deletion

An instrument can only be deleted if it has no legs. Deletion also removes all checkpoints and rate records for that instrument.

---

## Imports

The import pipeline converts bank and broker exports into events and legs. It runs in two stages: provider-specific parsing into a canonical format, followed by ingestion into the database.

### Canonical CSV Format

All provider parsers output the same canonical format:

| Column | Description |
|--------|-------------|
| `externalEventId` | Provider transaction ID (or hash if unavailable) |
| `eventGroup` | Groups multiple rows into one multi-leg event |
| `eventDescription` | Event-level description |
| `effectiveAt` | ISO 8601 transaction date |
| `postedAt` | ISO 8601 settlement date |
| `legDescription` | Per-leg description |
| `legTicker` | Instrument ticker (e.g. `AUD`, `USD`) |
| `legUnitCount` | Signed amount in minor units (cents for currencies, whole units for shares) |

### Supported Providers

#### Amex (CSV)
- Input: Amex CSV export (Date, Date Processed, Description, Amount, Reference)
- Sign convention: Amex exports charges as positive values; the parser negates them to negative cents (outflows)
- One leg per transaction in AUD

#### Amex (PDF)
- Input: PDF statement files named `YYYY-MM-DD.pdf` (closing date used for year inference)
- Extracts transactions via text clustering and column alignment
- Validates parsed totals against the statement's NEW CREDITS/DEBITS summary lines

#### CommBank (CSV)
- Input: CommBank CSV (Date, Amount, Description, Reference/Balance)
- Supports exports with or without headers
- Sign convention: positive = inflow, negative = outflow (standard)
- Falls back to a deterministic hash as the external ID if the Reference column is empty

#### CommBank (PDF)
- Input: PDF statement files
- Extracts transactions by detecting Date, Transaction, Debit, Credit, and Balance columns
- Infers year from the OPENING BALANCE row, incrementing on December → January rollovers
- Validates opening balance + parsed transactions = closing balance

#### Wise (CSV)
- Input: Wise CSV (ID, Status, Direction, Created, Finished, Amounts, Currencies)
- Direction handling:
  - `OUT` → 1 leg (source currency, negative)
  - `IN` → 1 leg (target currency, positive)
  - `NEUTRAL` → 2 legs (−source, +target for FX conversions)
- Rows with the same ID are grouped into one multi-leg event
- Cancelled transactions (`Status = CANCELLED`) are skipped

#### Vanguard (CSV)
- Input: Vanguard transaction CSV (Date, Type, Product Name, Product ID, Units, Total)
- Type handling:
  - `Deposit`, `Distribution` → 1 leg (+AUD)
  - `Buy` → 2 legs (−AUD cash, +ETF units with `exponent = 0`)

#### Vanguard (PDF)
- Input: Quarterly or annual statement PDFs
- Parses two tables: Cash Account transactions and Investment Transactions (trades)
- Validates cash account balances and verifies that Buy/Sell cash totals match trade totals

### Import Run Tracking

Each import is recorded in the `files` table with the following counters:

| Counter | Meaning |
|---------|---------|
| `importedCount` | New events created |
| `skippedCount` | Events already present (deduplication hit) |
| `restoredCount` | Soft-deleted events restored |
| `errorCount` | Rows that failed to import |

The `errors` field stores per-row error details (`line`, `message`, `phase`) for post-import review. The `skippedKeys` field lists the deduplication keys of skipped events.

### Import Flow

1. **Parse** — Run the provider-specific parser to produce a canonical CSV.
2. **Resolve instruments** — Create any new instruments referenced in the canonical CSV that don't yet exist in the account.
3. **Sort** — Order events by `effectiveAt`, with inflows before outflows at the same timestamp (to keep balances non-negative during insert).
4. **Commit** — For each parsed event: compute the `dedupeKey`, check for an existing match, insert or skip/restore, and resolve category paths from the `categoryAssignments` map.
5. **Rebuild** — Refresh monthly checkpoints and exchange rates for all affected instruments.

### Category Assignment During Import

The canonical CSV can include a `categoryAssignments` map keyed by `"{eventGroup}_{legIndex}"` with values as colon-separated category paths (e.g. `"food:coffee"`). The importer resolves these paths by walking the category hierarchy and sets `legs.categoryId` accordingly. Unresolvable paths are silently skipped — the leg is imported with `categoryId = NULL`.

### Import Wizard (Single File)

The account detail page (`/accounts/$accountId`) has an **"+ Import CSV"** button that opens a 4-step wizard inline:

1. **Select file** — The user picks a canonical CSV file. The file is parsed client-side immediately; any parse errors are shown before the user can proceed.
2. **Instruments** — All instrument tickers referenced in the CSV are listed. Existing instruments are shown read-only. New instruments (those not yet present in the account) show editable name and exponent fields — the user can rename or adjust decimal places before they are created on commit.
3. **Review** — Events are shown as a collapsible accordion. Expanding an event reveals its legs, each with an optional category path input (colon-separated, e.g. `food:coffee`). A "Restore soft-deleted duplicates" checkbox controls whether previously deleted events matching an incoming dedupe key should be restored rather than skipped.
4. **Commit** — A summary shows the account, filename, event count, new instruments, and restore setting. Clicking "Import" calls the server, which runs the full import flow and returns a file ID. On success the wizard closes and the page data is invalidated.

### Bulk Import Wizard (Multiple Files)

The **"Bulk import"** button on the account detail page opens an alternative 4-step wizard that processes multiple canonical CSV files in a single operation:

1. **Select files** — The user picks multiple CSV files at once (browser multi-select). All files are parsed client-side and sorted alphabetically by filename.
2. **Instruments** — Identical to the single-file wizard: all tickers across all files are deduplicated into one review step.
3. **Review** — A table lists every selected file with its parsed event count and error count. Files with parse errors are flagged but are not blocked from committing (files with zero events are skipped). The "Restore soft-deleted duplicates" option applies across all files.
4. **Commit** — Shows a summary (account, file count, total events, new instruments). After committing, the step transitions to a results table showing per-file `importedCount`, `skippedCount`, `restoredCount`, and `errorCount`. Each file is committed as a separate `files` row, so per-file history is preserved.

### Import History

All past imports are listed at `/accounts/$accountId/files`. Each row shows the filename, import timestamp, and the four counters. Clicking a row opens the file detail page, which shows:

- **Per-import stats** — imported, skipped, restored, and error counts displayed as stat cards.
- **Per-row errors** — if any rows failed, the error list shows the phase (`parse`, `commit`), line number, and message for each failure.
- **Imported events** — a paginated table of the events created by this import run.
- **Delete** — a "Delete" button soft-deletes all events from the file and removes the `files` row. Checkpoints are recomputed after deletion.
