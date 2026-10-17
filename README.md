# Finance

A personal finance app that imports bank statements, deduplicates them into canonical transactions, groups those into events made of legs, and reports cash flow as a Sankey diagram, with provenance back to every source file.

- [PRD](docs/PRD.md) · [Glossary](docs/glossary.md) · [ADRs](docs/ADR/) · [Feature specs](docs/features/)

## Status

All four slices of the [delivery plan](docs/PRD.md#12-delivery-plan) are built:

- Sign-in with passkeys or an emailed one-time code (Better Auth, Mailgun); one owner workspace per user.
- Commbank PDF statements (Smart Access, Everyday Offset, home loan) are uploaded to RustFS and imported by a background worker. Progress streams over SSE.
- Canonical transactions with soft-delete, reimport that restores original IDs, and manual suppression. Receipts (a PDF or photo) can be attached to a transaction as evidence; they are never read automatically.
- Events and legs rebuilt from transactions, their line items, append-only decisions (links, transfers, suppression) and leg assignments (categories, tags).
- Category tree and a cash-flow Sankey with drill-down and tag filters. Categories are given to event legs on the Events page; select legs (e.g. every uncategorised match for a search) to categorise them together. An uncategorised leg is suggested the category last given to the same description (ignoring case and numbers), and counts only once accepted. Transactions stay as imported, plus any line items you add, which become their own legs.
- Wise PDF statements (one per currency): conversions become one event across currency accounts, with fee legs.
- Merging an unconfirmed account into an existing one (e.g. a reissued card), and undoing it.
- Archiving an account by closing it on a date: it counts toward net worth up to that date, is hidden from lists and filters afterwards, and can be unarchived.
- Property equity: pair a property (or any asset account) with its loans and offsets, and its page shows equity today and over time. Pairing changes no total.
- An account page per account: its balance with the statement and date it came from, every reported balance, recent transactions and the statements that name it.
- Transfer matching between owned accounts, persisted as decisions, with a Transfers review page and manual link/unlink.
- Vanguard and IBKR PDF statements: holdings as instrument accounts, buys and conversions as single events, closing and trade prices.
- American Express PDF statements: one card account for every card member; payments match the paying account as transfers, and foreign purchases split out the conversion commission.
- Daily price CSV import with column mapping, conflict review, manual prices and instrument aliases; holdings with separate price, units and value charts.

- Valuation in AUD with FX rates as priced instruments, staleness and partial totals, display-only overrides, and manual accounts (with a warning when one looks like a tracked account).
- A dashboard with one global period control: net worth timeline, cash-flow Sankey and split bars, expenses by category with drill-down.
- Six sections, each with its own tabs: **Dashboard** (overview, cash flow), **Events** (events, transfers), **Accounts** (accounts, transactions, statements), **Categories**, **Assets** (holdings, prices) and **Settings**.
- A failed statement upload can be deleted, or uploaded again: the new upload replaces it rather than being refused as a duplicate.

Not built yet: a Stripe parser.

## Layout

```text
apps/web          TanStack Start app: pages, server functions, upload/SSE/download routes, Better Auth
apps/worker       Background worker: claims jobs from Postgres and runs statement imports
packages/db       Drizzle schema and migrations
packages/domain   Canonical types, fixed categories, row fingerprints
packages/contracts Zod schemas for API inputs, job payloads and progress records
packages/parsers  Statement parsers (Commbank, Wise, Vanguard, IBKR, Amex PDFs) and price CSV mapping
packages/imports  Job queue, RustFS storage, statement and price import pipelines
packages/ledger   Row and transfer matching, event projection, Sankey, holdings; `ledger/store` for DB-backed rebuilds
packages/shared   Decimal and date helpers (`shared/node` for Node-only helpers)
infra/            Docker Compose (Postgres, RustFS, migrate, web, worker) and Dockerfile
```

## Private data

Real statements live in `.personal/statements/<institution>/`. The folder is git-ignored and excluded from Docker builds, so statements are never committed or baked into images. Parser tests that read them skip when the folder is absent.

## Development

Requires Bun 1.4 and Docker.

```sh
bun install
cp .env.example .env          # then set BETTER_AUTH_SECRET (e.g. `openssl rand -hex 32`)
bun run infra:up              # Postgres on :54329, RustFS on :9000 (console :9001)
bun run db:migrate
bun run dev                   # web on http://localhost:5025 (PORT) and the worker
```

Sign in with your email. Without Mailgun settings in `.env`, the one-time code is printed in the web server log. Add a passkey from **Settings** afterwards. Set `ALLOWED_SIGNUP_EMAILS` to stop anyone else registering.

Then upload statements from **Accounts → Statements**. Review anything the transfer matcher could not decide on **Events → Transfers**.

### Checks

```sh
bun run typecheck
bun test                      # unit tests (+ parser tests against .personal/ when present)
bun run test:db               # also runs Postgres integration tests against the finance_test database
bun run docs:validate         # every feature doc must list every other feature
```

`test:db` expects a disposable `finance_test` database: `docker exec finance-postgres-1 psql -U finance -c 'create database finance_test'`. It truncates every table.

### Schema changes

Edit `packages/db/src/schema`, then `bun run db:generate` and `bun run db:migrate`.

## Running everything in Docker

```sh
docker compose --env-file .env -f infra/compose.yaml --profile app up --build
```

This runs migrations, then the web app on `127.0.0.1:5025` (or `PORT` from `.env`) and the worker. Postgres and RustFS ports are bound to localhost only. A Docker volume is not a backup.

## Documentation rules

Documentation changes with the code it describes: update the feature spec and the interaction row in every other feature doc, `docs/manifest.json`, the PRD when scope changes, and the glossary, then run `bun run docs:validate` (ADR 0008).
