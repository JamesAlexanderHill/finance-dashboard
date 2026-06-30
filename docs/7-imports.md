# Imports

The import pipeline turns a raw bank or broker file into [events and legs](./2-transactions.md). The **Import Wizard** takes a file, lets you **pick a parser** to convert it to a canonical event/leg format, then walks through instrument review, event review, and commit. Everything funnels through one canonical format, so the database-side ingestion is identical regardless of which parser produced the data.

There are two ways into the pipeline: the per-account Import Wizard (this page) and a developer shortcut on the [Dev Tools](./5-dev-tools.md#import-canonical-csv) page.

## Canonical Format

Every parser produces the same canonical shape — one row per leg, rows sharing an `eventGroup` merged into a single multi-leg event:

| Column | Description |
|--------|-------------|
| `externalEventId` | Provider transaction ID (or a deterministic hash when none exists) |
| `eventGroup` | Groups multiple rows into one multi-leg event |
| `eventDescription` | Event-level description |
| `effectiveAt` | ISO 8601 transaction date |
| `postedAt` | ISO 8601 settlement date |
| `legDescription` | Per-leg description |
| `legTicker` | Instrument ticker (e.g. `AUD`, `USD`, `VAS`) |
| `legUnitCount` | Signed amount in minor units (cents for currencies, whole units for shares) |

`parseCanonicalCsv` (`src/importers/canonical.ts`) parses this format in the browser into `ParsedEvent[]`; `src/db/services/service/import.ts` commits the result, resolving instruments and categories and deduplicating.

## Parsers

The wizard's first step is a **parser dropdown** (`src/importers/parser-options.ts`). The current options are:

| Parser | Input | Runs |
|--------|-------|------|
| **Canonical CSV** (default) | A CSV already in the canonical format above | In the browser |
| **Amex statement (PDF)** | Amex PDF statement | Server-side |
| **CommBank statement (PDF)** | Commonwealth Bank PDF statement | Server-side |
| **Vanguard statement (PDF)** | Vanguard Personal Investor PDF statement | Server-side |

### PDF statements (server-side)

PDF parsing depends on `pdfjs-dist` (~1 MB) and `node:crypto`, so it runs **server-side** via the `doParseFile` server function. The wizard uploads the raw bytes (base64) plus the chosen `parserId`; the handler **dynamically imports** the parser through `src/importers/pdf-registry.ts`, which means **pdfjs is never bundled into the client** — it only ever appears in a server chunk. The parser returns canonical CSV, which the browser feeds into the same `parseCanonicalCsv` path as a normal upload.

Per-provider extraction:

- **Amex (PDF)** — the file must be named `YYYY-MM-DD.pdf` (statement closing date); the year for each transaction is inferred from it. Transactions are read by clustering text items into rows and aligning columns, and parsed totals are validated against the statement's NEW CREDITS / NEW DEBITS summary.
- **CommBank (PDF)** — detects the Date / Transaction / Debit / Credit / Balance columns; infers the year from the OPENING BALANCE row (incrementing on a December → January rollover) and validates opening balance + transactions = closing balance.
- **Vanguard (PDF)** — parses two tables, the Cash Account transactions and the Investment Transactions (trades); validates cash balances and checks that Buy/Sell cash totals match the trade totals. Trades become a 2-leg event (−AUD cash, +ETF units).

Statement PDFs carry no transaction reference, so `externalEventId`/`eventGroup` are a deterministic hash of the row's contents (date, description, amount), with a collision-suffix for genuine duplicates within a statement.

### CSV bank parsers (CLI, deprecated)

The original provider CSV parsers — `amex`, `commbank`, `vanguard`, `wise` (`src/importers/<name>-parser.ts`) — remain standalone Bun CLI scripts:

```sh
bun src/importers/amex-parser.ts --in raw.csv --out canonical.csv
```

They convert a provider CSV export to the canonical format, which you then upload with the **Canonical CSV** parser. These are **slated for deprecation** and are intentionally not offered in the wizard; the PDF parsers above are the supported in-app path.

## Stored Originals

When a PDF is imported, the **raw upload is stored in object storage** and linked to the import. On commit, `commitEventsForFile` uploads the bytes and records the location on the `files` row:

| Column | Meaning |
|--------|---------|
| `parserId` | Which parser produced the events (`canonical`, `amex-pdf`, …) |
| `storageKey` | Object key of the stored raw file (`workspaces/{workspaceId}/files/{fileId}.pdf`) |
| `contentType` | MIME type of the stored file |
| `byteSize` | Size of the stored file in bytes |

Canonical-CSV imports record only `parserId` (no stored original). The upload is best-effort: if storage fails, the events still import and `storageKey` is left null.

Storage is S3-compatible and configured entirely from the environment (`src/lib/storage.ts`) — it works with AWS S3, Cloudflare R2, MinIO, etc.:

```
S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY   (required)
S3_REGION (default "auto"), S3_ENDPOINT, S3_FORCE_PATH_STYLE   (optional)
```

A bucket (or a local MinIO) is required to import PDFs; canonical-CSV imports work without it.

## Import Run Tracking

Each import is recorded in the `files` table with these counters:

| Counter | Meaning |
|---------|---------|
| `importedCount` | New events created |
| `skippedCount` | Events already present (deduplication hit) |
| `restoredCount` | Soft-deleted events restored |
| `errorCount` | Rows that failed to import |

The `errors` field stores per-row detail (`line`, `message`, `phase`); `skippedKeys` lists the dedupe keys of skipped events. Deduplication and restore behaviour are covered in [Transactions → Deduplication](./2-transactions.md#deduplication).

## Import Flow

1. **Parse** — Convert the chosen file to canonical events. Canonical CSVs are parsed in the browser; PDFs are parsed by `doParseFile` server-side and returned as canonical CSV.
2. **Resolve instruments** — Create any new instruments referenced that don't yet exist in the account.
3. **Sort** — Order events by `effectiveAt`, with inflows before outflows at the same timestamp (keeps balances non-negative during insert).
4. **Commit** — For each event: compute the `dedupeKey`, insert or skip/restore, resolve category paths, and (for PDFs) store the raw original and tag the `files` row.
5. **Rebuild** — Refresh monthly checkpoints and exchange rates for affected instruments.

### Category assignment during import

The single-file wizard can attach a category to each leg via a `categoryAssignments` map keyed by `"{eventGroup}_{legIndex}"`, with colon-separated paths (e.g. `food:coffee`). The importer walks the category hierarchy to resolve each path; unresolvable paths are silently skipped (the leg imports with `categoryId = NULL`).

## Import Wizard (single file)

The account detail page (`/accounts/$accountId`) has an **Import** button that opens a 4-step wizard inline:

1. **Select file** — Pick a **parser** from the dropdown, then choose a file (the file input's accepted types follow the parser). Canonical CSVs are parsed in the browser; PDFs are sent to the server parser. Parse errors are shown before you can proceed, and the raw PDF is held for storage on commit.
2. **Instruments** — Every ticker referenced is listed. Existing instruments are read-only; new ones expose editable name and exponent fields before they're created on commit.
3. **Review** — Events are shown as a collapsible accordion; expanding one reveals its legs, each with an optional category path input. A "Restore soft-deleted duplicates" checkbox controls whether incoming events matching a deleted dedupe key are restored rather than skipped.
4. **Commit** — A summary shows the account, filename, event count, new instruments, and restore setting. "Import" runs the flow server-side and returns the file ID; the wizard closes and the page refreshes.

## Bulk Import Wizard (multiple files)

The **Bulk import** button opens a parallel 4-step wizard. One parser applies to all selected files; each file is parsed (PDFs server-side, one per file), then committed as its own `files` row so per-file history is preserved. Step 3 lists every file with its event and error counts; files with errors are flagged but not blocked (zero-event files are skipped). Step 4 shows a per-file results table (`importedCount`, `skippedCount`, `restoredCount`, `errorCount`).

## Import History

Past imports are listed at `/accounts/$accountId/files`. Opening one shows the file detail page:

- **Header** — filename, import time, and the **parser** used (`parserLabel(file.parserId)`). When a raw original was stored, a **Download original** button fetches a short-lived presigned URL and opens it.
- **Stats** — imported / skipped / restored / error counts.
- **Errors** — per-row phase, line, and message for any failures.
- **Imported events** — a paginated table of the events created by this run.
- **Delete** — soft-deletes the file's events, removes the `files` row, and deletes the stored original from object storage (best-effort). Checkpoints are recomputed afterward.

## Implementation

| Piece | Location |
|-------|----------|
| Parser dropdown options + `parserLabel` | `src/importers/parser-options.ts` |
| Canonical parser (browser) + `legsToCanonicalCsv` | `src/importers/canonical.ts`, `src/importers/shared/canonical.ts` |
| PDF parsers (`parse<Provider>Pdf`) | `src/importers/{amex,commbank,vanguard}-pdf-parser.ts` |
| Server-only PDF registry (dynamic import → canonical CSV) | `src/importers/pdf-registry.ts` |
| `doParseFile` / `doCommitImport` server functions + wizard UI | `src/components/ImportWizard.tsx`, `src/components/BulkImportWizard.tsx` |
| Commit, instrument/category resolution, dedupe, raw-file storage | `src/db/services/service/import.ts` |
| Object storage client | `src/lib/storage.ts` |
| File list + detail (download, parser label, delete) | `src/routes/accounts/$accountId/files/*` |
