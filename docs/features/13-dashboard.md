# Financial Dashboard

**Feature ID:** `dashboard`  
**Owner:** Feature team  
**Status:** Draft (PRD v0.2)

## Purpose and scope

Aggregate historical/current net worth and cashflow, plus account and investment views.

## User stories

- As a workspace owner, I want to use financial dashboard so that I can manage accurate, traceable finances.

## Functional requirements

1. One page for a selected page period (presets: this/last month, this/last quarter, year to date, last year, last 30/90 days, last 12 months; previous/next stepping; custom dates; default this month), compared with the previous period: the previous calendar period for whole months, quarters and years, the same dates last year for year to date, otherwise the same number of days before.
5. Sections: summary cards (net worth, assets, liabilities at period end with change over the period; income, expenses, net cash flow, savings rate and top spending category vs the previous period); net worth as a stacked area (split: assets by account group above the line, liabilities below, net line; or net only); expenses to date as a stepped line; expenses stacked by top-level category with drill-down; income/expenses paired bars. A tag filter applies to cash-flow and expense views.
8. Each time-series chart has its own resolution (day/week/month/quarter/year; buckets clipped to the period, coarsened past 400) and a compare toggle overlaying the previous period as dashed lines aligned by bucket. The cash-flow Sankey is on the Dashboard's Sankey tab (old `/cash-flow` links redirect to `/sankey`); it has no resolution, and its compare toggle shows previous-period node values on hover.
2. Offer investment charts: price series, unit count series, and market-value series separately.
3. Use event classifications to avoid double-counted transfers and trades.
4. Expose lineage, valuation date, missing/stale and incomplete summaries.
6. Net worth is valued at each bucket end (or today for the current bucket; buckets after today are left empty); points marked partial or stale show why on hover. Foreign-currency cash-flow legs are converted at the rate applying on their date; legs with no rate are left out and counted.
7. Expenses stack by top-level category in the Sankey's colours; selecting a category shows its children. More than eight segments fold into "Other".

## Owned contracts and data

This feature owns its corresponding domain policies and primary records as described in [the PRD](../PRD.md). It must scope domain records to workspace, retain provenance where imported, use shared schemas in `packages/contracts`, and expose typed interfaces to other features.

## Failure modes and edge cases

- Reject cross-workspace requests, including direct file/object access.
- Keep source records/audit history on soft deletion; never silently fabricate financial values.
- Surface unsupported imports, conflicts, and inconsistent input for explicit review.

## Acceptance criteria

- AUD net worth = eligible converted assets minus eligible liabilities.
- A transaction source deletion, new valuation, or movement updates views.

## Testing notes

- Add domain unit tests, integration tests with PostgreSQL where persistence is involved, and one end-to-end user-path test.
- Exercise source replay, idempotence, and negative authorisation paths where relevant.

## Interactions with **all** other registered features

**Rule:** Every new feature must be added to this table, even if its relationship is `None`. Reciprocal documentation must be updated in the other feature.

| Other feature | Interaction | Direction / contract |
|---|---|---|
| [Core / Workspaces](00-core-workspaces.md) | Integration | Dashboard aggregates only balances, events, holdings and manual inputs for its workspace. |
| [Authentication](01-authentication.md) | Integration | Dashboard server functions verify owner access before financial aggregates are returned. |
| [Financial Accounts](02-financial-accounts.md) | Integration | Aggregates dated native-currency balances and identifies unavailable account data. |
| [Source Files / Statements](03-source-files-statements.md) | Integration | Shows import/data completeness issues caused by missing or inactive source files. |
| [Import Processing](04-import-processing.md) | Integration | Shows latest import status and invalidates affected queries after successful jobs. |
| [Transactions](05-transactions.md) | Integration | Exposes transaction traceability and account drilldowns for reported amounts. |
| [Events and Legs](06-events.md) | Integration | Income/expense/cashflow derived from event classification to avoid double counting. |
| [Reconciliation](07-reconciliation.md) | Integration | Surfaces unresolved matches that limit accurate event and cash-flow totals. |
| [Financial Instruments](08-instruments.md) | Integration | Groups holdings and charts using instrument labels and canonical identifiers. |
| [Asset Price History](09-asset-price-history.md) | Integration | Daily per-unit price history powers historical price and position market-value charts. |
| [Investment Holdings](10-holdings.md) | Integration | Renders dated units held and contributions through quantity changes. |
| [Valuation and FX](11-valuation-fx.md) | Integration | Net worth and historical values consume complete, date-aware, currency-aware valuations. |
| [Manual Accounts](12-manual-accounts.md) | Integration | Manual values contribute eligible assets/liabilities without duplicating tracked holdings. |
| [Categories and Sankey](14-categories.md) | Integration | Dashboard income/expense totals and the Sankey aggregate legs by top-level category kind. |

## Changes requiring reciprocal documentation

On creation or modification of a feature, amend this interaction table and corresponding rows in each linked feature document. A new feature requires an entry in **every existing feature file**. Also review its acceptance criteria, PRD scope, ADR decisions, and glossary.
