# Financial Instruments

**Feature ID:** `instruments`  
**Owner:** Feature team  
**Status:** Draft (PRD v0.2)

## Purpose and scope

Instrument identity for ETFs/shares across investments and historical prices.

## User stories

- As a workspace owner, I want to use financial instruments so that I can manage accurate, traceable finances.

## Functional requirements

1. Store ticker, ISIN where available, exchange, currency, type and canonical instrument identity.
2. Map provider instrument identifiers and price-CSV symbols to canonical instruments.
3. Do not merge identical tickers on different exchanges without validation.

## Owned contracts and data

This feature owns its corresponding domain policies and primary records as described in [the PRD](../PRD.md). It must scope domain records to workspace, retain provenance where imported, use shared schemas in `packages/contracts`, and expose typed interfaces to other features.

## Failure modes and edge cases

- Reject cross-workspace requests, including direct file/object access.
- Keep source records/audit history on soft deletion; never silently fabricate financial values.
- Surface unsupported imports, conflicts, and inconsistent input for explicit review.

## Acceptance criteria

- A holding and daily-price observation resolve to the same intended instrument.
- Ambiguous instrument mapping requires review.

## Testing notes

- Add domain unit tests, integration tests with PostgreSQL where persistence is involved, and one end-to-end user-path test.
- Exercise source replay, idempotence, and negative authorisation paths where relevant.

## Interactions with **all** other registered features

**Rule:** Every new feature must be added to this table, even if its relationship is `None`. Reciprocal documentation must be updated in the other feature.

| Other feature | Interaction | Direction / contract |
|---|---|---|
| [Core / Workspaces](00-core-workspaces.md) | Integration | Instrument identity mappings and workspace-specific user choices remain isolated. |
| [Authentication](01-authentication.md) | None | No direct interaction in v0.2; review if either feature changes scope. |
| [Financial Accounts](02-financial-accounts.md) | None | No direct interaction in v0.2; review if either feature changes scope. |
| [Source Files / Statements](03-source-files-statements.md) | None | No direct interaction in v0.2; review if either feature changes scope. |
| [Import Processing](04-import-processing.md) | Integration | Provider-specific trade and price identifiers are resolved to canonical instruments. |
| [Transactions](05-transactions.md) | Integration | Brokerage trade identifiers map source rows to canonical ETFs/shares. |
| [Events and Legs](06-events.md) | None | No direct interaction in v0.2; review if either feature changes scope. |
| [Reconciliation](07-reconciliation.md) | None | No direct interaction in v0.2; review if either feature changes scope. |
| [Asset Price History](09-asset-price-history.md) | Integration | CSV ticker/ISIN mappings resolve dated prices to specific canonical instruments. |
| [Investment Holdings](10-holdings.md) | Integration | Holdings key by canonical instrument, account, workspace, and effective date. |
| [Valuation and FX](11-valuation-fx.md) | Integration | Instrument denomination and exchange conventions determine correct unit-price interpretation. |
| [Manual Accounts](12-manual-accounts.md) | None | No direct interaction in v0.2; review if either feature changes scope. |
| [Financial Dashboard](13-dashboard.md) | Integration | Groups holdings and charts using instrument labels and canonical identifiers. |
| [Categories and Sankey](14-categories.md) | None | No direct interaction in v0.2; review if either feature changes scope. |

## Changes requiring reciprocal documentation

On creation or modification of a feature, amend this interaction table and corresponding rows in each linked feature document. A new feature requires an entry in **every existing feature file**. Also review its acceptance criteria, PRD scope, ADR decisions, and glossary.
