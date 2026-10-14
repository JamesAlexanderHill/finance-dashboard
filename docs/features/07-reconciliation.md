# Reconciliation

**Feature ID:** `reconciliation`  
**Owner:** Feature team  
**Status:** Draft (PRD v0.2)

## Purpose and scope

Cross-account matching, low-confidence review and manual overrides.

## User stories

- As a workspace owner, I want to use reconciliation so that I can manage accurate, traceable finances.

## Functional requirements

1. Match by reliable references, signed amounts, currencies and tolerant settlement dates. Auto-match a transfer only when two owned accounts show opposite-signed, exactly equal amounts in the same commodity within ±5 calendar days with exactly one candidate on each side; otherwise review.
2. Keep uncertain matches unresolved rather than silently merging.
3. Record audit-friendly manual confirmations/rejections; never overwrite them by reprocessing. Decisions are append-only: changes supersede, undo is a new decision, and history is viewable per transaction.
4. Persist automatic matches as system `link` decisions; never auto-match a transaction that already has a link decision (ADR 0012). A stated counterpart date (from a payment reference) restricts candidates to that posting date.
5. Provide a review queue of unmatched transfers (with plausible counterparts) and ambiguous candidates; allow linking any transactions in different accounts, unlinking a whole group, and marking a lone transaction as a transfer or not.

## Owned contracts and data

This feature owns its corresponding domain policies and primary records as described in [the PRD](../PRD.md). It must scope domain records to workspace, retain provenance where imported, use shared schemas in `packages/contracts`, and expose typed interfaces to other features.

## Failure modes and edge cases

- Reject cross-workspace requests, including direct file/object access.
- Keep source records/audit history on soft deletion; never silently fabricate financial values.
- Surface unsupported imports, conflicts, and inconsistent input for explicit review.

## Acceptance criteria

- Conflicting candidate links require review.
- User-confirmed linking survives new statement imports.

## Testing notes

- Add domain unit tests, integration tests with PostgreSQL where persistence is involved, and one end-to-end user-path test.
- Exercise source replay, idempotence, and negative authorisation paths where relevant.

## Interactions with **all** other registered features

**Rule:** Every new feature must be added to this table, even if its relationship is `None`. Reciprocal documentation must be updated in the other feature.

| Other feature | Interaction | Direction / contract |
|---|---|---|
| [Core / Workspaces](00-core-workspaces.md) | Integration | Automatic candidates and manual review decisions are restricted to a workspace. |
| [Authentication](01-authentication.md) | None | No direct interaction in v0.2; review if either feature changes scope. |
| [Financial Accounts](02-financial-accounts.md) | Integration | Account identity, currency and balance direction constrain transfer candidate matching. |
| [Source Files / Statements](03-source-files-statements.md) | None | No direct interaction in v0.2; review if either feature changes scope. |
| [Import Processing](04-import-processing.md) | Integration | Each import commit runs automatic transfer matching before rebuilding events, in the same DB transaction, and reports the number of transfers linked. |
| [Transactions](05-transactions.md) | Integration | Transaction provenance and stable IDs support safe link/unlink and duplicate-review decisions. |
| [Events and Legs](06-events.md) | Integration | Reconciliation consolidates matched transactions into one financial event and preserves manual decisions. |
| [Financial Instruments](08-instruments.md) | None | No direct interaction in v0.2; review if either feature changes scope. |
| [Asset Price History](09-asset-price-history.md) | None | No direct interaction in v0.2; review if either feature changes scope. |
| [Investment Holdings](10-holdings.md) | Integration | Transfer links and manual investment decisions may change quantity movement interpretation. |
| [Valuation and FX](11-valuation-fx.md) | None | No direct interaction in v0.2; review if either feature changes scope. |
| [Manual Accounts](12-manual-accounts.md) | None | No direct interaction in v0.2; review if either feature changes scope. |
| [Financial Dashboard](13-dashboard.md) | Integration | Surfaces unresolved matches that limit accurate event and cash-flow totals. |
| [Categories and Sankey](14-categories.md) | Integration | Refund-to-purchase links supply the refund's default category; category decisions share the decision store. |

## Changes requiring reciprocal documentation

On creation or modification of a feature, amend this interaction table and corresponding rows in each linked feature document. A new feature requires an entry in **every existing feature file**. Also review its acceptance criteria, PRD scope, ADR decisions, and glossary.
