# Relations

## Summary

The relations feature links two events as a transfer, reimbursement, or refund, so spending
and income analytics reflect what actually happened to a user's money rather than treating
every transaction in isolation.

## Goals

- Link an outflow (**parent**) to its offsetting or destination inflow (**child**) as a
  `transfer`, `reimbursement`, or `refund`.
- Suggest likely counterpart transactions when linking, using amount/date heuristics per
  relation type.
- Provide a pure netting transformation that other features' analytics can apply before
  aggregating legs.

## Non-goals

- This feature does not itself render spending analytics — it exposes netting as a function
  ([dashboard](06-dashboard.md) applies it).
- Suggested matches are heuristics, not a guarantee — always confirm before linking (see
  Failure modes).

## Domain terminology

See the [glossary](../glossary.md): **relation**. **Parent** = the original/anchor outflow;
**child** = the offsetting or destination inflow — assigned automatically from each event's
net amount sign when linking.

## Functional requirements

### Relation types

| Type            | Meaning                                                          | parent         | child              |
| --------------- | ---------------------------------------------------------------- | -------------- | ------------------ |
| `transfer`      | Internal movement between your own accounts; net worth unchanged | source outflow | destination inflow |
| `reimbursement` | Someone pays you back for an expense you covered                 | the expense    | the repayment      |
| `refund`        | A merchant reverses a purchase                                   | the purchase   | the refund         |

`reimbursement` and `refund` behave identically in analytics — the label only distinguishes
who sent the money back.

### Creating and removing

From the event drawer's Relations section: list existing relations (direction-aware label,
the other event's account/amount/date), open a "Link transaction" picker (suggested matches
per type, or free-text search excluding the current and already-linked events), or remove a
relation. The `(parentEventId, childEventId)` pair is unique — re-linking updates its type.

### Suggested matches

| Type            | Rule                                                                  |
| --------------- | --------------------------------------------------------------------- |
| `transfer`      | Opposite-signed, same amount, different account, within ±4 days       |
| `reimbursement` | Inflow within 14 days after the expense, amount less than the expense |
| `refund`        | Like reimbursement, but the inflow may equal the expense exactly      |

## Responsibilities

- Relation CRUD, scoped through the workspace of the events being linked (there is no
  `workspaceId` column on `event_relations` — both events are validated to belong to the
  caller's workspace before create/remove).
- The pure suggestion ranking (`suggestRelations`) and netting transformation
  (`applyRelationsToLegs`).

## Public contracts

`~/features/relations`:

- `relationService` — `listForEvent`, `searchCandidates`, `suggest`, `create`, `delete`,
  `getAnalyticsRelations` (the cross-feature entry point for dashboard's spend/income
  analytics — see below).
- `applyRelationsToLegs(legs, relations, childLegs)` — pure netting function.
- `suggestRelations` — pure ranking function. Type: `SuggestionEvent`.
- Types: `NettingLeg`, `NettingRelation`, `AnalyticsRelation`, `AnalyticsChildLeg`.

## Dependencies

None — depends only on the core platform. (Conceptually connects transactions' events, but
reads/writes the shared `events`/`event_relations` tables directly rather than importing the
transactions feature.)

## Interactions with other features

- **Transactions**' event drawer is the only UI surface for creating/removing relations, and
  calls `relationService` directly.
- **Dashboard**'s category-spending and Sankey services call
  `relationService.getAnalyticsRelations()` for the relation context needed to net legs before
  aggregating — this is the feature's one sanctioned cross-feature entry point, specifically so
  those features never reach into `relations`' internal query modules directly.

## Effect on analytics

Applied by `applyRelationsToLegs`, a pure function shared by dashboard's category-spending and
Sankey services:

- **Internal transfers are excluded** from spend/income aggregation entirely (balances are
  unaffected — the money really did move).
- **Reimbursements and refunds are netted**: the child's inflow is re-attributed to the
  parent's category, in the parent's period, using the parent's first categorized leg if it
  has more than one. If the parent has no categorized leg in the selected date range, the
  child inflow is simply omitted.
- Soft-deleted events are already excluded from analytics.
- If an event is in both a transfer and a reimbursement/refund relation, the transfer
  exclusion wins.

## Authorization and permissions

Both events in a relation are validated to belong to the caller's workspace before create/remove.

## Data ownership

`event_relations` (no `workspaceId` column — scoped through its events).

## Failure modes

- Linking an event to itself throws.
- Suggested matches are heuristic (amount/date based) — they miss FX transfers (differing
  amounts on each side) and can surface unrelated inflows.
- Netting attributes a multi-leg parent's reimbursement to a single category (its first
  categorized leg), not proportionally across all its legs.

## Acceptance criteria

- Linking a same-amount, opposite-signed transaction in a different account as a `transfer`
  removes both legs from spend/income totals without changing account balances.
- A reimbursement correctly reduces its parent expense's category total in the parent's
  period, not the period the repayment was received.

## Open questions

- None currently.

## Related architectural decisions

- [ADR 0004 — Feature-oriented architecture](../adr/0004-feature-oriented-architecture.md)
