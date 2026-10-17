# ADR 0014 — Categories on legs, line items on transactions

**Status:** Accepted
**Date:** 2026-10-17
**Amends:** [ADR 0006](0006-event-leg-ledger.md) §4 and its line-item identity follow-up

## Decision

1. **Two layers.** Accounts, statements and canonical transactions are data scraped from statements. Events and legs are the cross-account representation used by the UI and for accounting. The only thing a user adds to a transaction is its **line items**; everything else the user says about money (categories, tags) is said about **legs**.
2. **Line items are transaction data.** A transaction's line items are rows in `transaction_line_items`, each with its own stable ID and position. They must sum exactly to the transaction amount, share its sign, be non-zero and number at least two; a save that breaks this is rejected. Removing them all returns the transaction to a single leg. They replace the `itemisation` decision.
3. **Legs come from line items first, the transaction as a fallback.** When projecting events, a principal transaction with line items contributes one `line_item` leg per line (leg key `line:<line item id>`, in position order); otherwise it contributes one leg of its own (`principal` or `fee`). Stored line items that no longer sum to the transaction (e.g. its amount changed on reimport) are ignored and the transaction is its own leg again.
4. **Categories and tags are leg assignments.** They are stored in the append-only `leg_assignments` table, one current assignment per (leg, kind), where a later row supersedes an earlier one. Legs are rebuilt with fresh IDs, so an assignment names a leg by its stable identity: its transaction ID plus leg key. Because line-item leg keys use the line item's ID, editing other lines, reordering or adding lines never moves a category to a different line; an assignment on a removed line is kept but no longer projected.
5. **The API and UI address legs.** Categorising, accepting suggestions, finding similar legs and tagging take current leg IDs, which the server resolves to the leg's stable identity. Categorising happens on the Events page; the Transactions page shows a transaction's data, its line items and, read-only, the categories of its legs.
6. **Reconciliation decisions keep reconciliation.** `reconciliation_decisions` holds link, transfer and suppression decisions only. Earlier `category`, `tags` and `itemisation` rows were copied by migration `0011` (the latest per transaction and leg; `line:<index>` keys remapped to the new line item IDs) and are kept, unread, as history.

## Context and rationale

Keying categories on index-based line keys (`line:0`, `line:1`) let a re-itemisation silently move categories between lines, and storing user intent about legs as transaction decisions blurred the line between imported data and its accounting representation. Separating them keeps transactions a faithful record of statements plus the user's line items, and makes legs the single place categories live.

## Consequences

- Event and leg IDs remain deterministic and disposable (ADR 0006 §8); nothing references them durably.
- Category suggestions and similar-leg matching read `leg_assignments`.
- Deleting a category reassigns its legs by appending assignments.
- A transaction's history shows both its decisions and the assignments on its legs.

## Related specification

- [ADR 0006](0006-event-leg-ledger.md)
- [Transactions](../features/05-transactions.md), [Events and Legs](../features/06-events.md), [Categories and Sankey](../features/14-categories.md)
