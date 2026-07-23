# Glossary

Shared domain and architectural terminology. Feature documents link here rather than
redefining these terms themselves. Application-specific projects built from this scaffold
should extend this file with their own domain terms as they add features.

## Architectural terms

**Core platform** — The shared infrastructure in `src/core/` (auth, database, session,
workspaces, config, logging, errors, permissions, feature registry, health, testing). Owns
no business logic; every feature depends on it.

**Feature** — A first-class, independently documented unit of business functionality under
`src/features/<name>/`. Has a unique id, an explicit public contract (`index.ts`), and
declares its dependencies on other features. See [ADR 0004](adr/0004-feature-oriented-architecture.md).

**Public contract** — The set of types and functions a feature exports from its `index.ts`.
The only thing other features and routes are allowed to import from a feature — its
`domain/`, `infrastructure/`, and `ui/` internals are private.

**Domain layer** — A feature's business logic (`domain/`): validation, orchestration, and
rules, expressed independently of how data is persisted.

**Infrastructure layer** — A feature's persistence and external-system access (`infrastructure/`):
Drizzle queries, object storage clients, third-party API calls.

**Feature registration** — The explicit, typed process (`~/core/features`) by which each
feature contributes navigation entries, health checks, and other extension points at app
bootstrap. See [ADR 0005](adr/0005-feature-registration-and-dependencies.md).

**Shared code** (`src/shared/`) — Generic, reusable UI components and utilities with no
business meaning of their own (formatting helpers, a button component). Anything workspace-,
account-, or transaction-shaped belongs to a feature instead, not here. See
[ADR 0007](adr/0007-core-shared-feature-boundaries.md).

**App layer** (`src/app/`, `src/routes/`) — The composition root: route files (TanStack
Start's file-based routing) and the wiring that assembles registered features into the
running app. Routes may import from multiple features' public contracts; features may not
import each other's internals.

**Workspace** — The top-level, multi-tenant data boundary (core platform concept, not a
feature). Every piece of business data belongs to exactly one workspace. See
[core](features/00-core.md).

**Request context (`ctx` / `RequestContext`)** — The `{ userId, workspaceId }` pair threaded
through every service call, resolved once per request from the session and used to scope all
data access.

## Domain terms (finance dashboard example features)

**Account** — A financial institution or wallet (e.g. a bank account, brokerage). Belongs to
a workspace and holds one or more instruments. See [accounts](features/01-accounts.md).

**Instrument** — A currency or asset held within an account (e.g. AUD, a share ticker).
Account-scoped. See [accounts](features/01-accounts.md).

**Event** — A single financial transaction, made up of one or more legs. See
[transactions](features/02-transactions.md).

**Leg** — One side of an event: a signed flow of a specific instrument. See
[transactions](features/02-transactions.md).

**Category** — A user-defined, hierarchical label attached to legs/line items to classify
spending and income. See [categories](features/03-categories.md).

**Relation** — A link between two events (transfer, reimbursement, or refund) that changes
how they're treated in spend/income analytics. See [relations](features/04-relations.md).

**Checkpoint** — A stored monthly running balance for an instrument, avoiding a full ledger
scan on every balance query. See [accounts](features/01-accounts.md).

**Dedupe key** — A deterministic identifier used to detect and skip/restore duplicate
imported events. See [imports](features/05-imports.md).
