# Events and Legs

**Feature ID:** `events`  
**Owner:** Feature team  
**Status:** Draft (PRD v0.2)

## Purpose and scope

Consolidated cross-account economic events with typed movement legs and provenance.

## User stories

- As a workspace owner, I want to use events and legs so that I can manage accurate, traceable finances.

## Functional requirements

1. Transform active transactions into events and monetary/security/accounting legs.
2. Internal transfers are one event and not income or expense.
3. Investment buy/sell events affect units and cash, not ordinary consumption.
4. Provide cross-account timeline and per-leg source traceability.
5. Build one event from transactions sharing a provider reference or a current link group. Principal legs moving value both in and out make an internal event (a currency conversion when commodities differ, otherwise a transfer); fee rows become fee legs.
6. A lone transaction hinted or marked as a transfer, or whose linked counterpart is inactive, is an unmatched transfer: internal and excluded from income/expense.
7. Each transaction contributes its line items as legs when it has some that sum to its amount; otherwise the transaction itself is the leg (ADR 0014).
8. Events and legs are where the user categorises and tags (feature 14): the Events page lists each leg with its category, suggestion and tags, filters to uncategorised events, and selects legs for bulk categorisation.

## Owned contracts and data

This feature owns its corresponding domain policies and primary records as described in [the PRD](../PRD.md). It must scope domain records to workspace, retain provenance where imported, use shared schemas in `packages/contracts`, and expose typed interfaces to other features.

## Failure modes and edge cases

- Reject cross-workspace requests, including direct file/object access.
- Keep source records/audit history on soft deletion; never silently fabricate financial values.
- Surface unsupported imports, conflicts, and inconsistent input for explicit review.

## Acceptance criteria

- Multi-account transfers are not double counted.
- Deleted/restored source changes recompute dependent event views.

## Testing notes

- Add domain unit tests, integration tests with PostgreSQL where persistence is involved, and one end-to-end user-path test.
- Exercise source replay, idempotence, and negative authorisation paths where relevant.

## Interactions with **all** other registered features

**Rule:** Every new feature must be added to this table, even if its relationship is `None`. Reciprocal documentation must be updated in the other feature.

| Other feature | Interaction | Direction / contract |
|---|---|---|
| [Core / Workspaces](00-core-workspaces.md) | Integration | Financial event/leg generation and timeline queries never cross workspaces. |
| [Authentication](01-authentication.md) | None | No direct interaction in v0.2; review if either feature changes scope. |
| [Financial Accounts](02-financial-accounts.md) | Integration | Account-aware money legs link multi-account transfers into one economic activity. |
| [Source Files / Statements](03-source-files-statements.md) | None | No direct interaction in v0.2; review if either feature changes scope. |
| [Import Processing](04-import-processing.md) | Integration | Successful transaction imports trigger event/leg posting or replay for affected records. |
| [Transactions](05-transactions.md) | Integration | Eligible transactions produce economic events/legs, using their line items when present; event provenance points back to transactions. |
| [Reconciliation](07-reconciliation.md) | Integration | Reconciliation consolidates matched transactions into one financial event and preserves manual decisions. |
| [Financial Instruments](08-instruments.md) | None | No direct interaction in v0.2; review if either feature changes scope. |
| [Asset Price History](09-asset-price-history.md) | None | No direct interaction in v0.2; review if either feature changes scope. |
| [Investment Holdings](10-holdings.md) | Integration | Investment event legs emit signed quantity movements for tracked instruments. |
| [Valuation and FX](11-valuation-fx.md) | Integration | Economic legs provide spend/income classification and cash movements for valuation. |
| [Manual Accounts](12-manual-accounts.md) | None | No direct interaction in v0.2; review if either feature changes scope. |
| [Financial Dashboard](13-dashboard.md) | Integration | Income/expense/cashflow derived from event classification to avoid double counting. |
| [Categories and Sankey](14-categories.md) | Integration | Event projection applies leg assignments (categories, tags) to income/expense legs; internal events expose only fee/tax/interest legs. Categorising happens on the Events page. |

## Changes requiring reciprocal documentation

On creation or modification of a feature, amend this interaction table and corresponding rows in each linked feature document. A new feature requires an entry in **every existing feature file**. Also review its acceptance criteria, PRD scope, ADR decisions, and glossary.
