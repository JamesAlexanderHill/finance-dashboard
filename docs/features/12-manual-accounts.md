# Manual Accounts

**Feature ID:** `manual-accounts`  
**Owner:** Feature team  
**Status:** Draft (PRD v0.2)

## Purpose and scope

Track assets and liabilities that have no statements (house, car, superannuation, personal loans) as ordinary single-commodity financial accounts under a *Manual* institution, valued only through user-entered balance observations. There are no separate manual-asset tables.

## User stories

- As a workspace owner, I want to record the value of my house, car or super so that my net worth is complete.

## Functional requirements

1. Create manual accounts (asset or liability, one commodity) under the workspace's *Manual* institution.
2. Enter dated balance observations as the account's only data; revisions are retained for historical summaries.
3. Manual accounts participate in net worth, history and staleness exactly like imported accounts.
4. Warn when a manual account appears to duplicate a tracked financial account/holding.

## Owned contracts and data

This feature owns its corresponding domain policies and primary records as described in [the PRD](../PRD.md). It must scope domain records to workspace, retain provenance where imported, use shared schemas in `packages/contracts`, and expose typed interfaces to other features.

## Failure modes and edge cases

- Reject cross-workspace requests, including direct file/object access.
- Keep source records/audit history on soft deletion; never silently fabricate financial values.
- Surface unsupported imports, conflicts, and inconsistent input for explicit review.

## Acceptance criteria

- Manual property increases assets without double counting a linked bank balance.
- Values lacking FX do not inflate AUD net worth.

## Testing notes

- Add domain unit tests, integration tests with PostgreSQL where persistence is involved, and one end-to-end user-path test.
- Exercise source replay, idempotence, and negative authorisation paths where relevant.

## Interactions with **all** other registered features

**Rule:** Every new feature must be added to this table, even if its relationship is `None`. Reciprocal documentation must be updated in the other feature.

| Other feature | Interaction | Direction / contract |
|---|---|---|
| [Core / Workspaces](00-core-workspaces.md) | Integration | Manual property/vehicle/debt entries belong to a workspace and cannot leak. |
| [Authentication](01-authentication.md) | None | No direct interaction in v0.2; review if either feature changes scope. |
| [Financial Accounts](02-financial-accounts.md) | Integration | Tracked account balances must not be counted again as separate manually valued assets. |
| [Source Files / Statements](03-source-files-statements.md) | None | No direct interaction in v0.2; review if either feature changes scope. |
| [Import Processing](04-import-processing.md) | None | No direct interaction in v0.2; review if either feature changes scope. |
| [Transactions](05-transactions.md) | None | No direct interaction in v0.2; review if either feature changes scope. |
| [Events and Legs](06-events.md) | None | No direct interaction in v0.2; review if either feature changes scope. |
| [Reconciliation](07-reconciliation.md) | None | No direct interaction in v0.2; review if either feature changes scope. |
| [Financial Instruments](08-instruments.md) | None | No direct interaction in v0.2; review if either feature changes scope. |
| [Asset Price History](09-asset-price-history.md) | None | No direct interaction in v0.2; review if either feature changes scope. |
| [Investment Holdings](10-holdings.md) | None | No direct interaction in v0.2; review if either feature changes scope. |
| [Valuation and FX](11-valuation-fx.md) | Integration | Dated manual valuations supply liabilities/other assets for AUD conversion and net worth. |
| [Financial Dashboard](13-dashboard.md) | Integration | Manual values contribute eligible assets/liabilities without duplicating tracked holdings. |
| [Categories and Sankey](14-categories.md) | None | No direct interaction in v0.2; review if either feature changes scope. |

## Changes requiring reciprocal documentation

On creation or modification of a feature, amend this interaction table and corresponding rows in each linked feature document. A new feature requires an entry in **every existing feature file**. Also review its acceptance criteria, PRD scope, ADR decisions, and glossary.
