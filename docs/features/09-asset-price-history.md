# Asset Price History

**Feature ID:** `asset-price-history`  
**Owner:** Feature team  
**Status:** Draft (PRD v0.2)

## Purpose and scope

CSV uploads and retained dated unit-price observations used for historical charting.

## User stories

- As a workspace owner, I want to use asset price history so that I can manage accurate, traceable finances.

## Functional requirements

1. Support daily CSV with date, unit price, instrument mapping, currency and optional price type.
2. Validate and stage rows, preserve source row provenance, deduplicate exact overlaps.
3. Conflicting same-day prices require explicit resolution or deterministic approved precedence.
4. Record trade execution prices from statement trade rows as `trade`-type observations.
5. Keep manual single-date observations possible; soft-deleting a price file deactivates orphaned observations.
5. Provide effective-date series and missing/stale markers.

## Owned contracts and data

This feature owns its corresponding domain policies and primary records as described in [the PRD](../PRD.md). It must scope domain records to workspace, retain provenance where imported, use shared schemas in `packages/contracts`, and expose typed interfaces to other features.

## Failure modes and edge cases

- Reject cross-workspace requests, including direct file/object access.
- Keep source records/audit history on soft deletion; never silently fabricate financial values.
- Surface unsupported imports, conflicts, and inconsistent input for explicit review.

## Acceptance criteria

- Import 30 daily observations and graph per-unit value over time.
- Overlapping CSV does not duplicate identical dates/prices.
- A conflicting price is not silently overwritten.

## Testing notes

- Add domain unit tests, integration tests with PostgreSQL where persistence is involved, and one end-to-end user-path test.
- Exercise source replay, idempotence, and negative authorisation paths where relevant.

## Interactions with **all** other registered features

**Rule:** Every new feature must be added to this table, even if its relationship is `None`. Reciprocal documentation must be updated in the other feature.

| Other feature | Interaction | Direction / contract |
|---|---|---|
| [Core / Workspaces](00-core-workspaces.md) | Integration | Each price series and its source-row choices are isolated within a workspace. |
| [Authentication](01-authentication.md) | None | No direct interaction in v0.2; review if either feature changes scope. |
| [Financial Accounts](02-financial-accounts.md) | None | No direct interaction in v0.2; review if either feature changes scope. |
| [Source Files / Statements](03-source-files-statements.md) | Integration | Price CSV files are preserved as evidence; soft deletion deactivates unsupported price observations. |
| [Import Processing](04-import-processing.md) | Integration | Price CSV parse/validation runs through persistent jobs and streams progress. |
| [Transactions](05-transactions.md) | None | No direct interaction in v0.2; review if either feature changes scope. |
| [Events and Legs](06-events.md) | None | No direct interaction in v0.2; review if either feature changes scope. |
| [Reconciliation](07-reconciliation.md) | None | No direct interaction in v0.2; review if either feature changes scope. |
| [Financial Instruments](08-instruments.md) | Integration | CSV ticker/ISIN mappings resolve dated prices to specific canonical instruments. |
| [Investment Holdings](10-holdings.md) | Integration | Dated unit prices combine with the independently derived dated unit counts. |
| [Valuation and FX](11-valuation-fx.md) | Integration | Effective-date instrument prices supply native-currency valuation inputs and data completeness. |
| [Manual Accounts](12-manual-accounts.md) | None | No direct interaction in v0.2; review if either feature changes scope. |
| [Financial Dashboard](13-dashboard.md) | Integration | Daily per-unit price history powers historical price and position market-value charts. |
| [Categories and Sankey](14-categories.md) | None | No direct interaction in v0.2; review if either feature changes scope. |

## Changes requiring reciprocal documentation

On creation or modification of a feature, amend this interaction table and corresponding rows in each linked feature document. A new feature requires an entry in **every existing feature file**. Also review its acceptance criteria, PRD scope, ADR decisions, and glossary.
