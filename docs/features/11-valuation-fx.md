# Valuation and FX

**Feature ID:** `valuation-fx`  
**Owner:** Feature team  
**Status:** Draft (PRD v0.2)

## Purpose and scope

Calculate dated native-currency and AUD values with completeness/staleness rules.

## User stories

- As a workspace owner, I want to use valuation and fx so that I can manage accurate, traceable finances.

## Functional requirements

1. Value(t) = units(t) × selected unit price(t), with date and currency retained. Daily price preferred; `trade` price only as fallback within the staleness window, marked *trade-priced*.
2. Store dated FX observations and source metadata; imported via the price-import CSV pipeline with a currency pair treated as a priced instrument.
3. Do not silently convert currencies 1:1 or use future prices for prior historical dates.
4. Display incomplete/stale results when required input data is absent; prices/FX older than the previous business day's close are stale.
5. Allow a cosmetic *override current price* (instruments and FX) for visualising current value; persisted per instrument/pair, badged, cleared when a newer observation arrives; display-only, never stored as an observation or used in totals.

## Owned contracts and data

This feature owns its corresponding domain policies and primary records as described in [the PRD](../PRD.md). It must scope domain records to workspace, retain provenance where imported, use shared schemas in `packages/contracts`, and expose typed interfaces to other features.

## Failure modes and edge cases

- Reject cross-workspace requests, including direct file/object access.
- Keep source records/audit history on soft deletion; never silently fabricate financial values.
- Surface unsupported imports, conflicts, and inconsistent input for explicit review.

## Acceptance criteria

- Unit count increase without a price increase is not presented as return.
- Missing historical price/FX shows a gap or explicit status.

## Testing notes

- Add domain unit tests, integration tests with PostgreSQL where persistence is involved, and one end-to-end user-path test.
- Exercise source replay, idempotence, and negative authorisation paths where relevant.

## Interactions with **all** other registered features

**Rule:** Every new feature must be added to this table, even if its relationship is `None`. Reciprocal documentation must be updated in the other feature.

| Other feature | Interaction | Direction / contract |
|---|---|---|
| [Core / Workspaces](00-core-workspaces.md) | Integration | Reporting currency, FX selection and valuation aggregation run inside workspace scope. |
| [Authentication](01-authentication.md) | None | No direct interaction in v0.2; review if either feature changes scope. |
| [Financial Accounts](02-financial-accounts.md) | Integration | Dated cash balances and account currencies provide native-currency valuation inputs. |
| [Source Files / Statements](03-source-files-statements.md) | None | No direct interaction in v0.2; review if either feature changes scope. |
| [Import Processing](04-import-processing.md) | None | No direct interaction in v0.2; review if either feature changes scope. |
| [Transactions](05-transactions.md) | Integration | Transaction amounts and balance-affecting events can inform dated balances, never missing market prices. |
| [Events and Legs](06-events.md) | Integration | Economic legs provide spend/income classification and cash movements for valuation. |
| [Reconciliation](07-reconciliation.md) | None | No direct interaction in v0.2; review if either feature changes scope. |
| [Financial Instruments](08-instruments.md) | Integration | Instrument denomination and exchange conventions determine correct unit-price interpretation. |
| [Asset Price History](09-asset-price-history.md) | Integration | Effective-date instrument prices supply native-currency valuation inputs and data completeness. |
| [Investment Holdings](10-holdings.md) | Integration | Units as-of each date multiply by the appropriate dated unit price. |
| [Manual Accounts](12-manual-accounts.md) | Integration | Dated manual valuations supply liabilities/other assets for AUD conversion and net worth. |
| [Financial Dashboard](13-dashboard.md) | Integration | Net worth and historical values consume complete, date-aware, currency-aware valuations. |
| [Categories and Sankey](14-categories.md) | Integration | Dated FX converts non-AUD legs for Sankey totals; missing rates are flagged. |

## Changes requiring reciprocal documentation

On creation or modification of a feature, amend this interaction table and corresponding rows in each linked feature document. A new feature requires an entry in **every existing feature file**. Also review its acceptance criteria, PRD scope, ADR decisions, and glossary.
