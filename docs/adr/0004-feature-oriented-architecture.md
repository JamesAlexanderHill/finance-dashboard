# 0004 — Feature-oriented architecture

## Status

Accepted

## Context

As an application grows, organizing code by technical layer (all routes together, all
services together, all components together) makes it hard to answer "what does this feature
depend on?", "can I safely remove this?", or "where do I add a new one?" without reading the
whole codebase. The scaffold instead needs features to be first-class, independently
understandable, and removable units.

## Decision

Organize application code under `src/features/<name>/`, each with:

- A unique id (declared in a small `feature.ts`, distinct from its public `index.ts`).
- A public contract: `index.ts` is the _only_ thing other features or routes may import from
  a feature. Internal layers (`domain/`, `infrastructure/`, `ui/`) are private.
- Explicit `dependencies` on other features' ids, validated at bootstrap (see
  [ADR 0005](0005-feature-registration-and-dependencies.md)).
- Only the layers it actually needs — a feature with no persistence-adjacent code doesn't get
  an empty `infrastructure/` folder.

This scaffold's own concrete features (accounts, transactions, categories, relations, imports,
dashboard, dev-tools — see `docs/features/`) are the worked example: each was carved out along
its actual data/service boundaries, not invented as a placeholder.

## Consequences

- Cross-feature calls go through the target feature's `index.ts`, never its `domain/*` or
  `infrastructure/*` directly — enforced by convention and code review, not (yet) an automated
  lint rule. A feature's internal reorganization can't break another feature as long as its
  public contract's shape is preserved.
- A feature can, in principle, be deleted by deleting its directory, removing it from
  `src/app/features.ts`, and removing any other feature's now-dangling dependency on it — no
  scattered references elsewhere, because nothing else imported its internals.
- Some cross-feature coupling is real and declared explicitly (e.g. transactions depends on
  accounts, categories, and relations) rather than hidden — see each feature's "Dependencies"
  section in `docs/features/`.
- This does **not** mean every feature is fully isolated at the database level — see
  [ADR 0002](0002-use-drizzle-and-postgres.md) and [ADR 0007](0007-core-shared-feature-boundaries.md)
  for where the schema itself sits.

## Alternatives considered

- **Layered ("MVC-style") architecture** (all routes/, all services/, all components/) — the
  structure this scaffold replaced. Rejected as the primary organization because it doesn't
  scale to "what can I safely remove" or "what does this depend on" without full-codebase
  familiarity.
- **One package per feature (monorepo)** — considered for even stronger isolation, but rejected
  as unnecessary overhead for a single-deployable application at this scale; a folder
  convention plus registration validation gets most of the benefit without the tooling cost.

## Related features or ADRs

- [ADR 0005 — Feature registration and dependency management](0005-feature-registration-and-dependencies.md)
- [ADR 0007 — Boundaries between core, shared, and features](0007-core-shared-feature-boundaries.md)
- [Documentation README](../README.md)
