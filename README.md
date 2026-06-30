# Finance Dashboard

A personal finance dashboard for tracking accounts, balances, and transactions across
multiple providers (bank accounts, brokerages, multi-currency wallets), built with
TanStack Start (React 19, SSR + file-based routing), TanStack Router/Query/Table,
Drizzle ORM over Postgres, and Tailwind v4.

## Getting started

This project uses [Bun](https://bun.sh).

```sh
bun install
docker compose up -d   # starts Postgres on localhost:5332
bun db:push            # push the Drizzle schema (no migration files are checked in)
bun dev                # start the dev server at http://localhost:3000
```

The app starts with no users or data. Visit `/dev` (dev-mode only) to seed a demo
user, accounts, instruments, and categories ("Seed base"), then optionally "Seed
sample events". "Clear all data" wipes everything in dependency order.

## Commands

- `bun install` — install dependencies
- `bun dev` — start the dev server (Vite + TanStack Start, port 3000)
- `bun build` — production build
- `bun serve` — preview the production build
- `bun start` — run the built server (`dist/server/server.js`)
- `bun db:push` — push the Drizzle schema to Postgres (`drizzle-kit push`)
- `bun db:studio` — open Drizzle Studio
- `bun test` — run unit/functional tests (`bun:test`)
- `bun test:e2e` — run Playwright e2e tests (see [e2e](e2e/))

### Local database

Postgres runs via `docker-compose.yml`, exposed on host port `5332`, with data
persisted to `.db/` (gitignored). Connection details come from `.env`
(`DATABASE_URL`, `POSTGRES_*`), pointing at
`postgresql://dev:development@localhost:5332/db`.

### Object storage (imports)

Raw import uploads (PDF statements) are kept in S3-compatible object storage, configured entirely
from the environment — works with AWS S3, Cloudflare R2, MinIO, etc.:

- `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` (required)
- `S3_REGION` (defaults to `auto`), `S3_ENDPOINT` (for non-AWS providers), and
  `S3_FORCE_PATH_STYLE` (`true` for MinIO) (optional)

A bucket (or a local MinIO) is required to import PDFs; canonical-CSV imports work without it.

## Architecture

### Data model

The schema (`src/db/schema.ts`) is built around `users`, `accounts`, `instruments`,
`files`, `events`, and `legs`:

- Each `account` (e.g. "CommBank", "Wise") belongs to a `user` and holds one or more
  account-scoped `instruments` (currencies/assets, e.g. "AUD", "VHY").
- An `event` is a financial happening (purchase, transfer, exchange, trade, bill
  payment, payout) belonging to one account, made up of one or more `legs`. Each leg
  references an instrument and carries a signed `unitCount` in minor units (cents,
  etc.) — money is always handled as bigints, never `Number`.
- A `file` records an import run — its parser (`parserId`), result counts, and a reference to the
  stored raw upload (`storageKey`/`contentType`/`byteSize`) when one was kept — and owns the
  `events` it created.
- `instrumentCheckpoints` store a monthly running balance per instrument so balances
  can be computed without summing every leg from the beginning.
- `legs` can be split into `lineItems` and tagged with `categories` (a
  self-referential tree).
- `eventRelations` link two events as an internal transfer, reimbursement, or
  refund, making the spending analytics relation-aware — transfers are excluded
  and reimbursements/refunds offset the linked expense (see
  [docs/6-relations.md](docs/6-relations.md)).

### Service layer

`src/db/services/` is split into `query/*` (raw Drizzle queries) and `service/*`
(business logic on top, scoped by `RequestContext`/`ctx.userId`). Everything is
re-exported from `src/db/services/index.ts` — import from `~/db/services`.

### Imports

The **Import Wizard** (per account) takes a file, lets you pick a **parser**, converts it to the
canonical event/leg format, then walks instrument review → event review → commit. **PDF statements**
(Amex, CommBank, Vanguard) are parsed **server-side** so pdfjs never ships in the client bundle, and
the original upload is stored in object storage and linked to the import (with the parser used,
downloadable from the import's detail page). Canonical CSVs are parsed in the browser; the non-PDF
CSV bank parsers remain standalone Bun CLI scripts, slated for deprecation.

See **[docs/7-imports.md](docs/7-imports.md)** for the full pipeline — canonical format, parsers,
object-storage of originals, run tracking, the single-file and bulk wizards, and import history.

## Testing

- **Unit & functional tests** (`bun test`) live alongside the code in `__tests__/`
  directories under `src/lib/` and `src/importers/`, covering formatting/scaling
  helpers, the shared importer utilities, canonical CSV parsing, and each provider's
  CSV parser run end-to-end against fixture files.
- **E2E tests** (`bun test:e2e`, Playwright) live in [`e2e/`](e2e/) and cover core
  navigation flows (dashboard, accounts, events, categories). They run against an
  isolated `db_test` Postgres database (see `playwright.config.ts`) so the dev
  tools' "Clear all data" action never touches real data.

More details on conventions and gotchas are in [CLAUDE.md](CLAUDE.md).
