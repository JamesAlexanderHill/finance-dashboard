# Transactions

**Feature ID:** `transactions`  
**Owner:** Feature team  
**Status:** Draft (PRD v0.2)

## Purpose and scope

Canonical normalised transaction identity, source occurrences, soft-delete and reimport behaviour.

## User stories

- As a workspace owner, I want to use transactions so that I can manage accurate, traceable finances.

## Functional requirements

1. One transaction may reference multiple active/soft-deleted statement rows.
2. Provider IDs preferred for deduplication: rows with one match by (account, provider ID); others by fingerprint. Ambiguous collisions routed to review.
3. Statement-sourced inactivity and explicit user suppression are distinct states.
4. Restore original ID when a source-deactivated transaction reappears; preserve manual suppression unless explicitly restored.
5. Keep source hints on the transaction (provider reference, principal/fee role, transfer hint); a reimport refreshes them without changing identity.
6. Transactions are data from statements. The only thing a user adds to one is its **line items** (ADR 0014): two or more non-zero parts with the transaction's sign that sum exactly to its amount (otherwise the save is rejected). Each line item has a stable ID, so editing, adding or removing lines never changes another line's identity. Removing all line items returns the transaction to a single leg.
7. Categories and tags are not set on transactions; the Transactions page shows its legs' categories read-only and links to its event, where they are set.

## Owned contracts and data

This feature owns its corresponding domain policies and primary records as described in [the PRD](../PRD.md). It must scope domain records to workspace, retain provenance where imported, use shared schemas in `packages/contracts`, and expose typed interfaces to other features.

## Failure modes and edge cases

- Reject cross-workspace requests, including direct file/object access.
- Keep source records/audit history on soft deletion; never silently fabricate financial values.
- Surface unsupported imports, conflicts, and inconsistent input for explicit review.

## Acceptance criteria

- A/B overlapping import produces unique logical transactions.
- Deletion/restoration updates active projections without hard delete.
- Line items that do not sum exactly to the transaction amount are rejected; saved ones become the transaction's legs, and a line keeps its category when other lines change.

## Testing notes

- Add domain unit tests, integration tests with PostgreSQL where persistence is involved, and one end-to-end user-path test.
- Exercise source replay, idempotence, and negative authorisation paths where relevant.

## Interactions with **all** other registered features

**Rule:** Every new feature must be added to this table, even if its relationship is `None`. Reciprocal documentation must be updated in the other feature.

| Other feature | Interaction | Direction / contract |
|---|---|---|
| [Core / Workspaces](00-core-workspaces.md) | Integration | Canonical transaction queries and uniqueness scopes include the workspace boundary. |
| [Authentication](01-authentication.md) | None | No direct interaction in v0.2; review if either feature changes scope. |
| [Financial Accounts](02-financial-accounts.md) | Integration | Each canonical transaction references the owned financial account whose statement supplied it, or the account that one is merged into. |
| [Source Files / Statements](03-source-files-statements.md) | Integration | Transaction-source join rows preserve overlap, restoration and statement deletion semantics. Receipts attach to a canonical transaction by ID, so reimports keep them attached. |
| [Import Processing](04-import-processing.md) | Integration | Statement imports upsert canonical transactions and their source occurrence links idempotently. |
| [Events and Legs](06-events.md) | Integration | Eligible transactions produce economic events/legs; event provenance points back to transactions. |
| [Reconciliation](07-reconciliation.md) | Integration | Transaction provenance and stable IDs support safe link/unlink and duplicate-review decisions. |
| [Financial Instruments](08-instruments.md) | Integration | Brokerage trade identifiers map source rows to canonical ETFs/shares. |
| [Asset Price History](09-asset-price-history.md) | None | No direct interaction in v0.2; review if either feature changes scope. |
| [Investment Holdings](10-holdings.md) | Integration | Investment transactions create quantity movements; restored/deactivated trades recalculate holdings. |
| [Valuation and FX](11-valuation-fx.md) | Integration | Transaction amounts and balance-affecting events can inform dated balances, never missing market prices. |
| [Manual Accounts](12-manual-accounts.md) | None | No direct interaction in v0.2; review if either feature changes scope. |
| [Financial Dashboard](13-dashboard.md) | Integration | Exposes transaction traceability and account drilldowns for reported amounts. |
| [Categories and Sankey](14-categories.md) | Integration | Line items on a transaction become its legs; category and tag assignments name a leg by transaction ID plus leg key (`line:<line item id>` for line items). |

## Changes requiring reciprocal documentation

On creation or modification of a feature, amend this interaction table and corresponding rows in each linked feature document. A new feature requires an entry in **every existing feature file**. Also review its acceptance criteria, PRD scope, ADR decisions, and glossary.
