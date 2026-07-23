# 0007 — Boundaries between core, shared, and application features

## Status

Accepted

## Context

`src/` has three kinds of code — `core/`, `shared/`, and `features/` — plus the app
composition layer (`src/app/`, `src/routes/`). Without a clear rule for what belongs where,
"core" tends to accumulate business logic by accretion (it's always tempting to put something
"everyone might need" there), and features end up coupled through whatever they both happen to
import.

## Decision

- **`src/core/`** — capabilities most features need, with **no application-specific business
  logic**: auth, session/workspace resolution, the shared database schema and client,
  configuration, logging, typed errors, authorization primitives, the feature registry, health
  checks, testing utilities. A capability belongs here only if it doesn't encode any feature's
  domain rules — workspaces are core (multi-tenancy, not a business feature) even though they
  look domain-shaped, because every feature depends on workspace scoping to function at all.
- **`src/shared/`** — generic, reusable building blocks with **no business meaning of their
  own**: UI primitives (`button`, `table`, `select`, …), formatting/utility functions, and
  small shared types (e.g. a generic `RecurrenceRule`). If a type or component is meaningful
  only in the context of one feature's domain (an account color _select_, a category
  _selector_), it belongs in that feature's `ui/`, not here — `shared/` is for things that
  would make sense in a completely different application built on this same scaffold.
- **`src/features/<name>/`** — application-specific business logic, one feature per
  subdirectory, per [ADR 0004](0004-feature-oriented-architecture.md).
- **`src/app/` and `src/routes/`** — the composition root. `src/routes/` is fixed by TanStack
  Start's file-based routing convention (see [ADR 0001](0001-use-tanstack-start.md)) and may
  import from _multiple_ features' public contracts to assemble a page — that's composition,
  not a feature-boundary violation. `src/app/features.ts` assembles the registered feature set.

A capability only moves "up" (feature → shared, or feature → core) once it has a second,
independent concrete consumer — never speculatively. Two examples from this scaffold's own
history: the account-color-to-chart-shade class map started inside a dashboard chart component
and moved to `shared/utilities/chart-colors.ts` only once the accounts feature's color picker
also needed it; a duplicated test-cleanup query in two features' integration tests became
`~/core/testing`'s `queryTestUserIdsByEmailDomain` only once two features needed the same helper.

### A bundling-specific corollary

A feature's public `index.ts` re-exports **both** server-only domain/infrastructure code and
client-rendered UI components side by side — that's the point of a single public contract.
But a **static** re-export from that barrel of a module that must never reach the client
bundle (e.g. a PDF-parsing registry that pulls in `node:fs`/`pdfjs-dist`) can defeat the
framework's server/client code-splitting even if nothing actually _calls_ the re-exported
function client-side, because the bundler still has to bind that module's own top-level
imports. The rule: anything that must only run server-side and is only ever reached via a
dynamic `import()` at its point of use (see the imports feature's PDF registry) must **not**
also be statically re-exported from the feature's `index.ts` — doing so silently reintroduces
the exact bundle leak the dynamic import was written to prevent.

## Consequences

- `core/` stays small by construction — anything domain-specific that starts creeping in
  (e.g. "just add an accounts helper to core since everything needs accounts") should be
  challenged: does _every_ feature need this, or just several of them? The latter is a
  candidate for `shared/`, not `core/`.
- Reviewers checking a new `shared/` addition should ask "would this make sense in an app with
  none of this scaffold's example features?" — if the answer is no, it belongs in a feature.
- The dynamic-import corollary means a feature's `index.ts` is not simply "re-export
  everything public" — a small number of exports (documented inline, as in the imports
  feature's `index.ts`) are deliberately withheld from the static barrel.

## Alternatives considered

- **No `shared/` layer — put everything reusable in `core/`** — rejected: it would blur core's
  "no business logic" boundary immediately (a `Button` component is fine in core-adjacent
  shared code; an account-color picker is not core).
- **Feature-owned schema (split `schema.ts` per feature)** — considered and rejected; see
  [ADR 0002](0002-use-drizzle-and-postgres.md) for why the schema is shared core infrastructure.
- **Enforce the boundary with an import-linting rule** (e.g. dependency-cruiser) — a good
  future addition once the scaffold has more than one real application built on it to validate
  the rule against; not added now to avoid codifying a boundary before it's been exercised.

## Related features or ADRs

- [ADR 0002 — Use Drizzle ORM and PostgreSQL](0002-use-drizzle-and-postgres.md)
- [ADR 0004 — Feature-oriented architecture](0004-feature-oriented-architecture.md)
- [ADR 0005 — Feature registration and dependency management](0005-feature-registration-and-dependencies.md)
- [Imports feature doc](../features/05-imports.md)
