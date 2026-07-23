# 0005 — Feature registration and dependency management

## Status

Accepted

## Context

Given feature-oriented architecture ([ADR 0004](0004-feature-oriented-architecture.md)),
something needs to assemble the app's actual feature set at startup, wire each feature's
extension points (navigation, health checks, …) into the running app, and catch a missing or
circular dependency before it becomes a confusing runtime bug.

## Decision

Define a typed `AppFeature` contract (`~/core/features`):

```ts
export interface AppFeature {
  readonly id: string
  readonly dependencies?: readonly string[]
  register(context: FeatureRegistrationContext): void
}
```

Each feature exports one `AppFeature` object from its own `feature.ts` (kept separate from its
`index.ts` public contract specifically so the app's composition root, `src/app/features.ts`,
never has to import a feature's full barrel — including its UI/domain code — just to read its
id and dependencies; see [ADR 0007](0007-core-shared-feature-boundaries.md)).
`src/app/features.ts` lists the app's feature set and calls `registerFeatures()`, which:

1. Rejects duplicate ids.
2. Rejects a dependency on an id that isn't in the set.
3. Detects circular dependencies.
4. Calls each feature's `register(context)` in dependency order (dependencies first).

Any violation throws `FeatureDependencyError` — the app fails to boot rather than run with a
feature silently missing a dependency or registered out of order.

`register(context)` currently supports `registerNav` (sidebar entries — the app shell's
`Sidebar` renders `appNav`, contributed by every feature, instead of a hardcoded list) and
`registerHealthCheck` (aggregated by `~/core/health`'s `runHealthChecks`). Both extension
points already have a real, non-hypothetical consumer (see the constraint below).

## Consequences

- Adding a feature to the app is one line in `src/app/features.ts`; removing one is deleting
  that line (plus the feature's directory).
- A feature's `dependencies` list is the authoritative, checked statement of what it needs to
  exist first — not just documentation. It's not, and isn't intended to be, a full static
  analysis of actual imports; keeping it accurate is a code-review discipline, matching the
  index numbering in `docs/features/` being a _reading_ order, not this _loading_ order.
- New extension points (e.g. background jobs, permission grants) should only be added to
  `FeatureRegistrationContext` when a real feature needs one — see the "no abstraction without
  a concrete use case" constraint this scaffold follows throughout.

## Alternatives considered

- **Filesystem-convention auto-discovery** (e.g. glob-scan `src/features/*/feature.ts`) —
  rejected in favor of an explicit list in `src/app/features.ts`: the plan this scaffold
  follows prefers "explicit registration and composition over implicit filesystem magic," and
  an explicit list is what makes dependency-order validation possible before any feature code runs.
- **No dependency declaration at all** (features just import what they need and hope) — this
  is close to what the pre-refactor codebase did implicitly; rejected because it gives no
  early signal when a dependency is missing or circular.

## Related features or ADRs

- [ADR 0004 — Feature-oriented architecture](0004-feature-oriented-architecture.md)
- [Core feature doc](../features/00-core.md)
