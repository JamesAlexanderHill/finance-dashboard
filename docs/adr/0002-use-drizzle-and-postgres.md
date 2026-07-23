# 0002 — Use Drizzle ORM and PostgreSQL

## Status

Accepted

## Context

The scaffold needs a primary relational database and a way to define its schema and query it
from TypeScript, with strong typing, without hiding SQL behind a heavy abstraction.

## Decision

Use PostgreSQL as the primary database and [Drizzle ORM](https://orm.drizzle.team/) as the
query builder/schema layer. The schema lives in one place (`src/core/database/schema.ts`) as
core infrastructure — not split per feature — because relational foreign keys between
feature-owned tables (e.g. `legs.instrumentId → instruments.id`) make a fully-partitioned
schema impractical without giving up referential integrity or introducing a lot of
cross-feature ceremony for a single connection/single database. Each feature still owns _its_
tables conceptually (documented per feature in `docs/features/`) and is the only code that
writes business rules around them; the schema file itself is core because it's the shared
data-access substrate every feature depends on, not because core owns the business meaning of
the tables.

Migrations use `drizzle-kit push` in development (`bun db:push`); use `drizzle-kit generate`
for versioned migration files in a real application.

## Consequences

- Every feature's `infrastructure/*-query.ts` files import the shared schema from
  `~/core/database/schema` — this is a sanctioned "features depend on core" edge, not a
  feature-to-feature violation.
- Cross-feature joins for analytics (e.g. dashboard's spending charts joining
  categories/legs/events) are written directly against the shared schema rather than composed
  from multiple features' service calls, for query performance — see
  [ADR 0007](0007-core-shared-feature-boundaries.md) for where that line is drawn.
- Money is always handled as `bigint` (minor units), never `number`, to avoid floating-point
  drift — enforced by convention, not the type system, so review new schema columns for this.

## Alternatives considered

- **Prisma** — a heavier, more "batteries-included" ORM with its own schema DSL and codegen
  step; Drizzle was chosen for staying closer to SQL, lighter runtime overhead, and first-class
  TypeScript inference without a separate generate step blocking every schema change.
- **Raw SQL / a query builder like Kysely** — viable, but Drizzle's schema-as-TypeScript
  approach gives the same type safety with less hand-written type plumbing.
- **A NoSQL document store** — rejected: the domain is inherently relational (accounts →
  instruments → events → legs, with categories and relations cutting across them), so a
  relational database is the natural fit.

## Related features or ADRs

- [ADR 0007 — Boundaries between core, shared, and features](0007-core-shared-feature-boundaries.md)
