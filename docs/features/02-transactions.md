# Transactions

## Summary

The transactions feature owns the core ledger — events and their legs — including the event
drawer UI used to review, edit, categorize, and link transactions everywhere else in the app.

## Goals

- Model a financial transaction as an **event** made up of one or more **legs**, never
  physically deleted (soft-delete via `deletedAt`, preserving history and allowing re-import
  to restore).
- Provide a single reusable **event drawer** for viewing/editing an event's details, legs,
  line items, and relations from anywhere in the app.
- Provide a deterministic **dedupe key** so re-importing the same data is safe.

## Non-goals

- Deciding how categories are structured — that's [categories](03-categories.md); this feature
  only stores the `categoryId` tag on legs/line items.
- Modeling transfers/reimbursements/refunds between events — that's [relations](04-relations.md).
- Turning a bank/broker file into events — that's [imports](05-imports.md).

## Domain terminology

See the [glossary](../glossary.md): **event**, **leg**, **dedupe key**. A **line item** is a
sub-split of a leg (e.g. one grocery leg split into produce/meat/dairy line items); the sum of
line-item amounts must equal the parent leg's `unitCount`.

## Functional requirements

### Event types

`purchase`, `transfer`, `exchange`, `trade`, `bill_payment`, `payout`.

### Dates

Each event tracks `effectiveAt` (when it occurred) and `postedAt` (when it settled) —
usually equal, but can differ (e.g. a cheque). Balance calculations use `effectiveAt`.

### Legs

Most events have one leg; multi-leg events cover currency exchanges (2 legs), share purchases
(cash + units), and split purchases (one leg per spending category). Each leg has a signed
`unitCount` in minor units, an optional `categoryId`, and an optional description.

### Deduplication

`dedupeKey = "{accountId}:{externalEventId}"` when the source provides a transaction id,
otherwise `SHA256("{accountId}|{effectiveAt}|{amountMinor}|{normalizedDescription})"`. On
import, a matching key is skipped (already imported) or restored (if soft-deleted and the user
opts in) — see [imports](05-imports.md).

### Event drawer

Opens as a slide-in panel via the `viewEvent` search param on the current route. Shows event
details, a delete/restore toggle (recomputes checkpoints/rates immediately), per-leg category
assignment, an expandable line-item editor per leg, and a relations section (see
[relations](04-relations.md)).

### Events pages

`/events` — cross-account, paginated, with an account filter. `/accounts/$accountId/events` —
the same table scoped to one account. Both open the event drawer on row click.

## Responsibilities

- Event/leg CRUD and pagination, scoped to the caller's workspace.
- The event drawer UI, event table, and event preview table components used across the app.
- Computing dedupe keys is _not_ this feature's job (see [imports](05-imports.md)'s
  `computeDedupeKey`) — this feature only looks events up by dedupe key.

## Public contracts

`~/features/transactions`:

- `eventService` — `listByAccount`, `listByFile`, `listByInstrument`, `listAll`,
  `listUncategorized`, `listSimilarUncategorized`, `getByDedupeKey`.
- UI: `EventDrawer`, `EventTable`, `EventPreviewTable`, `EventLegBar`, `buildCategoryColorMap`.

## Dependencies

- **accounts** — the event drawer calls `checkpointService`/`rateService` after edits/deletes.
- **categories** — the drawer and tables use `categoryService` and the `CategorySelector` UI to
  tag legs.
- **relations** — the drawer's relations section uses `relationService`.

## Interactions with other features

- **Imports** creates events/legs directly (via the shared database schema, not through this
  feature's service layer) and looks up existing events by dedupe key through
  `eventService.getByDedupeKey`.
- **Dashboard** and **categories**' spending analytics query legs/events directly against the
  shared schema (an analytics-scale concern, not routed through `eventService`).

## Authorization and permissions

All operations are scoped by `RequestContext.workspaceId`.

## Data ownership

`events`, `legs`, `line_items`.

## Failure modes

- Line-item amounts that don't sum to their parent leg's `unitCount` block saving in the drawer.
- Looking up an event outside the caller's workspace returns nothing (scoped queries), not an error.

## Acceptance criteria

- Deleting then restoring an event via the drawer leaves its legs and categorization intact
  and recomputes affected balances.
- Re-importing a file that produced a given dedupe key skips (or restores) rather than
  duplicating that event.

## Open questions

- None currently.

## Related architectural decisions

- [ADR 0004 — Feature-oriented architecture](../adr/0004-feature-oriented-architecture.md)
