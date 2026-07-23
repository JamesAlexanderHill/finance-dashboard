# Documentation

This directory is the project's second source of truth alongside the code — documentation-driven
development means a feature's requirements, contracts, dependencies, and interactions are written
down here, next to (not instead of) the typed contracts and tests that actually enforce them.

## Structure

```
docs/
  README.md          — this file
  glossary.md         — shared domain and architectural terminology
  features/           — one document per feature (plus one for the core platform)
  adr/                 — architecture decision records
```

## Features (`docs/features/`)

Each document follows `docs/features/${index}-${feature-name}.md`, e.g. `01-accounts.md`.

**The index is a stable reading order, not the runtime feature-loading order** — see each
feature's `dependencies` in its own `feature.ts` (`~/core/features`) for the actual load-order
constraints, validated automatically at bootstrap.

Every feature document follows the same template (sections that don't apply are omitted, but the
structure stays consistent — see any file in `features/` for a worked example):

```
# Feature Name
## Summary
## Goals
## Non-goals
## Domain terminology
## Functional requirements
## Responsibilities
## Public contracts
## Dependencies
## Interactions with other features
## Authorization and permissions
## Data ownership
## Events and extension points
## Failure modes
## Acceptance criteria
## Open questions
## Related architectural decisions
```

Feature documents describe _behavior and contracts_, not visual design — spacing, color, and
component placement belong in code/Storybook, not here, unless the UI behavior itself is a
functional requirement (e.g. "categories render as an indented tree").

## Architecture Decision Records (`docs/adr/`)

Architecturally significant decisions are recorded under `docs/adr/${four-digit-index}-${decision-name}.md`.
Each ADR records its status, context, decision, consequences, alternatives considered, and related
features/ADRs. See [`adr/0001-use-tanstack-start.md`](adr/0001-use-tanstack-start.md) onward.

## Extending this scaffold

When you add an application-specific feature:

1. Add `src/features/<name>/` (only the layers it needs — see the core `00-core.md` doc for the
   suggested source structure).
2. Register it in `src/app/features.ts`.
3. Add `docs/features/${next-index}-<name>.md` describing it, using the template above.
4. If the feature involved an architecturally significant decision (a new dependency, a new
   cross-cutting pattern), record it under `docs/adr/`.
