# 0006 — Documentation philosophy

## Status

Accepted

## Context

Documentation that drifts from the code it describes is worse than no documentation — it
actively misleads. At the same time, typed contracts and tests can't express _why_ a feature
exists, what its boundaries are, or what invariants it depends on. The scaffold needs a
documentation convention that stays useful without substituting for the things code actually
enforces.

## Decision

Documentation-driven development here means: a feature's requirements, contracts,
dependencies, and interactions are written down in `docs/features/${index}-${name}.md`
_alongside_ — never instead of — its typed public contract (`index.ts`) and its tests.

Ground rules:

- Every feature document follows the same template (see `docs/README.md`), so any feature is
  equally easy to navigate regardless of who wrote it.
- Documents describe _behavior and contracts_: goals, domain terms, functional requirements,
  responsibilities, public contracts, dependencies, interactions with other features,
  authorization, data ownership, failure modes, acceptance criteria, open questions.
- Documents do **not** prescribe UI implementation details (exact spacing, colors, component
  placement) unless the behavior itself is a functional requirement (e.g. "recurring
  annotations show their frequency in the legend" is a requirement; "the legend uses an amber
  dashed line" is not something this doc layer should own).
- Shared terminology is defined once in `docs/glossary.md`; feature documents link to it
  instead of redefining it inline, so a term's meaning can't drift between documents.
- Architecturally significant decisions — the kind that would be expensive to reverse or that
  future contributors will ask "why did we do it this way?" about — are recorded as ADRs
  (`docs/adr/`), separate from feature documents, because a decision's rationale and
  alternatives don't belong inside the description of the feature it happens to affect.
- The feature index (`00`, `01`, `02`, …) is a stable _reading_ order for humans, not the
  runtime feature-loading order — that's the checked `dependencies` list in each feature's
  `feature.ts` (see [ADR 0005](0005-feature-registration-and-dependencies.md)).

## Consequences

- Documentation cannot be used as a substitute for a typed contract or a test — if a document
  says a feature "must" do something, that must also be enforced in code (a type, a
  validation, a test), or the document is describing an aspiration, not a fact.
- Adding a feature means adding a matching document in the same change, not as a follow-up —
  otherwise the index gap and the missing dependency-declaration cross-check are easy to miss
  in review.
- Documents will still drift if not kept current; the convention lowers that risk (one
  template, one glossary, links instead of redefinitions) but does not eliminate it.

## Alternatives considered

- **Inline code comments only** — insufficient for cross-cutting concerns like "what does this
  feature depend on" or "what's the failure mode when X" that don't attach to one line of code.
- **A wiki or external docs site** — rejected: separating documentation from the repository it
  describes makes it easier for the two to drift, and harder to review documentation changes
  alongside the code change that motivated them.
- **Generated API docs only (typedoc, etc.)** — useful as a supplement, but can't capture "why"
  or "what does this interact with" — the parts a type signature can't express.

## Related features or ADRs

- [Documentation README](../README.md)
- [Glossary](../glossary.md)
- [ADR 0004 — Feature-oriented architecture](0004-feature-oriented-architecture.md)
