# Imports

## Summary

The imports feature turns a raw bank or broker file into events and legs, through a shared
canonical format so ingestion is identical regardless of which parser produced the data.

## Goals

- Provide a single **canonical** event/leg CSV format that every provider parser converts to,
  so the commit path only needs to understand one shape.
- Support both server-side PDF parsing (keeping `pdfjs`/Node dependencies out of the client
  bundle via dynamic import) and browser-side canonical CSV parsing.
- Store the raw uploaded original (for PDF imports) in object storage, linked to the import run.
- Track every import run's outcome (imported/skipped/restored/error counts) for auditability.

## Non-goals

- Deduplication logic itself lives in [transactions](02-transactions.md) (`dedupeKey`); this
  feature computes the key and decides skip/restore/import based on it.
- The original provider CSV parsers (`amex`/`commbank`/`vanguard`/`wise`) are deprecated
  standalone CLI scripts, not part of the in-app wizard.

## Domain terminology

See the [glossary](../glossary.md): **dedupe key**. **Canonical format** — the shared
event/leg CSV shape (`externalEventId`, `eventGroup`, dates, descriptions, `legTicker`,
`legUnitCount`) every parser produces, one row per leg with rows sharing an `eventGroup`
merged into one multi-leg event.

## Functional requirements

### Parsers

| Parser                                     | Input                             | Runs                              |
| ------------------------------------------ | --------------------------------- | --------------------------------- |
| Canonical CSV (default)                    | A CSV already in canonical format | Browser                           |
| Amex / CommBank / Vanguard statement (PDF) | Provider PDF statement            | Server-side, dynamically imported |

PDF parsing depends on `pdfjs-dist` and Node's `crypto`/`fs`, so `doParseFile` dynamically
imports the parser registry (`~/features/imports/infrastructure/parsers/pdf-registry`) —
**this module must only ever be reached via a dynamic `import()`**, never a static re-export,
or its Node-only dependencies leak into the client bundle (see
[ADR 0007](../adr/0007-core-shared-feature-boundaries.md)). Each provider's PDF parser
validates its own extraction against the statement's summary totals before returning
canonical rows. Statement PDFs carry no transaction reference, so ids are a deterministic hash
of each row's contents.

### Stored originals

On commit, a PDF import's raw bytes are uploaded to S3-compatible object storage
(`S3_BUCKET`/`S3_ACCESS_KEY_ID`/`S3_SECRET_ACCESS_KEY`, optional `S3_REGION`/`S3_ENDPOINT`/
`S3_FORCE_PATH_STYLE`) and the `files` row records `storageKey`/`contentType`/`byteSize`. The
upload is best-effort — a storage failure doesn't block the import. Canonical-CSV imports
record only `parserId`, no stored original. A bucket is required only to import PDFs.

### Import run tracking

Each run is a `files` row with `importedCount`, `skippedCount`, `restoredCount`, `errorCount`,
per-row `errors` (line/message/phase), and `skippedKeys`.

### Import flow

1. Parse the file to canonical events (browser for CSV, server for PDF).
2. Resolve/create instruments referenced by the file.
3. Sort events by `effectiveAt` (inflows before outflows at the same timestamp, keeping
   balances non-negative during insert).
4. Commit each event: compute the dedupe key, insert/skip/restore, resolve category paths.
5. Refresh checkpoints and exchange rates for every affected instrument.

### Wizards

**Import Wizard** (single file, from an account's page): select file/parser → review
instruments → review events (with per-leg category path input, and a restore-deleted-
duplicates toggle) → commit. **Bulk Import Wizard**: the same flow across multiple files
sharing one parser, each committed as its own `files` row.

### Import history

`/accounts/$accountId/files` lists past imports; the detail page shows stats, per-row errors,
the imported events, a download link for the stored original (if any), and delete (soft-deletes
the file's events, removes the row, best-effort deletes the stored original, recomputes
checkpoints).

## Responsibilities

- Parsing (canonical + per-provider PDF), instrument/category resolution, deduplication,
  commit, and raw-file storage.
- Import-run tracking and history.

## Public contracts

`~/features/imports`:

- `importService` — `commitImport`, `commitBulkImport`. Types: `CommitImportParams`,
  `CommitBulkImportParams`, `InstrumentDraft`, `RawContent`, `FileImportResult`, `BulkImportFile`.
- `fileService` — `getById`, `getDownloadUrl`, `listByUser`, `listByAccount`, `countsByAccount`, `delete`.
- `parseCanonicalCsv`, `PARSER_OPTIONS`, `DEFAULT_PARSER_ID`, `parserLabel`.
- UI: `ImportWizard`, `BulkImportWizard` (and their server functions).
- **Not** exported statically: `runPdfParserToCsv` — reach it only via
  `import('~/features/imports/infrastructure/parsers/pdf-registry')` at the point of use.

## Dependencies

- **accounts** — resolves the target account, creates instruments, refreshes checkpoints/rates.
- **transactions** — looks up existing events by dedupe key (`eventService.getByDedupeKey`).
- **categories** — resolves `categoryAssignments` paths via `categoryService.list()`.

## Interactions with other features

Consumed by account detail pages (Import/Bulk import buttons) and by
[dev tools](07-dev-tools.md)'s canonical-CSV quick import, which reuses the same commit path.

## Authorization and permissions

All operations are scoped by `RequestContext.workspaceId`.

## Data ownership

`files` (import run tracking). Does not own `events`/`legs` (written into transactions'
tables) or the stored originals (external object storage, referenced by `storageKey`).

## Failure modes

- A row that fails to parse/commit is recorded in `errors` with its line, message, and phase;
  the rest of the file still imports.
- A duplicate dedupe key is skipped (or restored, if the user opted in and it was
  soft-deleted) rather than erroring.
- A storage upload failure is logged and the `files` row is left with a null `storageKey` —
  the import itself still succeeds.
- Importing without S3 configured works for canonical CSV but fails to store PDF originals
  (the events still import; only the stored-original feature is unavailable).

## Acceptance criteria

- Importing the same file twice does not duplicate events (second run reports the events as skipped).
- A PDF import never causes `pdfjs-dist` or its parser modules to appear in the client bundle.
- Checkpoints and rates reflect the newly imported events immediately after commit.

## Open questions

- The standalone CSV bank-parser CLI scripts are slated for removal once every provider has a
  supported in-app (PDF or canonical) path.

## Related architectural decisions

- [ADR 0004 — Feature-oriented architecture](../adr/0004-feature-oriented-architecture.md)
- [ADR 0007 — Boundaries between core, shared, and features](../adr/0007-core-shared-feature-boundaries.md)
