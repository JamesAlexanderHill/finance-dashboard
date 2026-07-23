# Finance Dashboard

A reusable, feature-oriented TypeScript web application scaffold — built with TanStack Start
(React 19, SSR + file-based routing), Drizzle ORM over Postgres, Better Auth, and Tailwind v4 —
demonstrated here as a working personal finance dashboard (accounts, transactions, categories,
relations, imports, and a spending dashboard).

Everything application-specific lives under `src/features/`; the platform it's built on
(auth, database, config, logging, feature registration, health checks) lives under
`src/core/` and is free of business logic. See [`docs/`](docs/) for the full architecture,
one document per feature, plus the architecture decision records behind the scaffold's
design.

## Getting started

This project uses [Bun](https://bun.sh).

```sh
bun install
docker compose up -d   # starts Postgres on localhost:5332
bun db:push            # push the Drizzle schema (no migration files are checked in)
bun dev                # start the dev server at http://localhost:3000
```

The app starts with no users or data. Visit `/dev` (dev-mode only) to seed a demo user,
accounts, instruments, and categories ("Seed base"), then optionally "Seed sample events".
"Clear all data" wipes everything in dependency order.

## Commands

- `bun install` — install dependencies
- `bun dev` — start the dev server (Vite + TanStack Start, port 3000)
- `bun build` — production build
- `bun serve` — preview the production build
- `bun start` — run the built server (`dist/server/server.js`)
- `bun db:push` — push the Drizzle schema to Postgres (`drizzle-kit push`)
- `bun db:studio` — open Drizzle Studio
- `bun typecheck` — type-check the whole project (`tsc --noEmit`)
- `bun lint` — lint (`eslint .`)
- `bun format` — format the codebase in place (`prettier --write .`)
- `bun format:check` — check formatting without writing (`prettier --check .`)
- `bun test` — run unit/functional tests (`bun:test`)
- `bun test:e2e` — run Playwright e2e tests (see [e2e](e2e/))

### Local database

Postgres runs via `docker-compose.yml`, exposed on host port `5332`, with data persisted to
`.db/` (gitignored). Connection details come from `.env` (`DATABASE_URL`, `POSTGRES_*`),
pointing at `postgresql://dev:development@localhost:5332/db`.

### Environment variables

Copy `.env.example` to `.env` and fill in the required values (Postgres connection, Better
Auth secret/URL, passkey RP id). Every variable is validated at startup by
`src/core/config/env.ts` — see [the core platform doc](docs/features/00-core.md) for what
each one does, including the optional sign-in method toggles (`AUTH_MAGIC_LINK_ENABLED`,
`AUTH_PASSKEY_ENABLED`, `AUTH_SSO_PROVIDERS_JSON`) and object-storage settings for PDF import
uploads.

### Object storage (imports)

Raw import uploads (PDF statements) are kept in S3-compatible object storage, configured
entirely from the environment — works with AWS S3, Cloudflare R2, MinIO, etc.:

- `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` (required)
- `S3_REGION` (defaults to `auto`), `S3_ENDPOINT` (for non-AWS providers), and
  `S3_FORCE_PATH_STYLE` (`true` for MinIO) (optional)

A bucket (or a local MinIO) is required to import PDFs; canonical-CSV imports work without it.

## Architecture

```
src/
  app/          — composition root: assembles and registers the app's feature set
  core/         — platform: auth, database, session, workspaces, config, logging,
                  errors, permissions, feature registry, health, testing (no business logic)
  features/     — application-specific business logic, one directory per feature
  shared/       — generic, reusable UI components and utilities (no business meaning)
  routes/       — TanStack Start file-based routes (thin — compose features' public contracts)
```

Each feature (`src/features/<name>/`) has a unique id, an explicit public contract
(`index.ts` — the only thing other features or routes may import from it), declared
dependencies on other features (validated at bootstrap — see
[ADR 0005](docs/adr/0005-feature-registration-and-dependencies.md)), and only the internal
layers (`domain/`, `infrastructure/`, `ui/`) it actually needs.

The current features, in reading order (see [`docs/features/`](docs/features/) for the full
requirements/contracts/dependencies of each):

| #   | Feature                                          | Summary                                                      |
| --- | ------------------------------------------------ | ------------------------------------------------------------ |
| 00  | [Core](docs/features/00-core.md)                 | Auth, workspaces, settings — the platform, not a feature     |
| 01  | [Accounts](docs/features/01-accounts.md)         | Accounts, instruments, balance checkpoints, exchange rates   |
| 02  | [Transactions](docs/features/02-transactions.md) | Events and legs — the core ledger, plus the event drawer     |
| 03  | [Categories](docs/features/03-categories.md)     | The workspace's hierarchical category tree                   |
| 04  | [Relations](docs/features/04-relations.md)       | Linking events as transfers, reimbursements, refunds         |
| 05  | [Imports](docs/features/05-imports.md)           | Turning bank/broker files into events via a canonical format |
| 06  | [Dashboard](docs/features/06-dashboard.md)       | Net worth, balance history, spending analytics, annotations  |
| 07  | [Dev Tools](docs/features/07-dev-tools.md)       | Dev-only seeding, reset, and workspace snapshots             |

### Data model

The schema (`src/core/database/schema.ts`) is built around `users`, `accounts`,
`instruments`, `files`, `events`, and `legs`:

- Each `account` (e.g. "CommBank", "Wise") belongs to a `user`'s workspace and holds one or
  more account-scoped `instruments` (currencies/assets, e.g. "AUD", "VHY").
- An `event` is a financial happening (purchase, transfer, exchange, trade, bill payment,
  payout) belonging to one account, made up of one or more `legs`. Each leg references an
  instrument and carries a signed `unitCount` in minor units (cents, etc.) — money is always
  handled as bigints, never `Number`.
- A `file` records an import run — its parser (`parserId`), result counts, and a reference to
  the stored raw upload (`storageKey`/`contentType`/`byteSize`) when one was kept — and owns
  the `events` it created.
- `instrumentCheckpoints` store a monthly running balance per instrument so balances can be
  computed without summing every leg from the beginning.
- `legs` can be split into `lineItems` and tagged with `categories` (a self-referential tree).
- `eventRelations` link two events as an internal transfer, reimbursement, or refund, making
  the spending analytics relation-aware — see [docs/features/04-relations.md](docs/features/04-relations.md).

### Feature registration

`src/app/features.ts` lists the app's feature set and calls `registerFeatures()`
(`~/core/features`), which validates dependencies (rejecting duplicate ids, unknown
dependencies, and circular dependencies) and calls each feature's `register()` in dependency
order. Registered features contribute navigation entries (rendered by the app shell's
sidebar) and health checks (aggregated at `/api/health`). See
[ADR 0005](docs/adr/0005-feature-registration-and-dependencies.md).

## Testing

- **Unit & functional tests** (`bun test`) live alongside the code in `__tests__/` directories
  throughout `src/`, covering formatting/scaling helpers, importer parsing, relation netting
  and suggestion logic, timeline annotation recurrence, and (where `DATABASE_URL` is set) auth
  and snapshot integration tests.
- **E2E tests** (`bun test:e2e`, Playwright) live in [`e2e/`](e2e/) and cover core navigation
  flows (dashboard, accounts, events, categories). They run against an isolated `db_test`
  Postgres database (see `playwright.config.ts`) so the dev tools' "Clear all data" action
  never touches real data.

## Extending this scaffold

To build a new application from this scaffold:

1. Copy or template the repository.
2. Configure environment variables (`.env.example`).
3. Define application-specific features under `src/features/<name>/`.
4. Register them in `src/app/features.ts`.
5. Add `docs/features/${next-index}-<name>.md` describing each (see [docs/README.md](docs/README.md) for the template).
6. Record any architecturally significant decisions under `docs/adr/`.

More conventions and gotchas: see [`docs/README.md`](docs/README.md), the
[glossary](docs/glossary.md), and the [ADRs](docs/adr/).
