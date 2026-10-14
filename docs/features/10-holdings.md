# Investment Holdings

**Feature ID:** `holdings`  
**Owner:** Feature team  
**Status:** Draft (PRD v0.2)

## Purpose and scope

Calculate instrument quantities over time from position movements and verified opening snapshots.

## User stories

- As a workspace owner, I want to use investment holdings so that I can manage accurate, traceable finances.

## Functional requirements

1. Support buy/sell, transfer, reinvestment, stock split and extensible corporate-action movements. Reinvested distributions are an income event plus a separate buy event.
2. Dated snapshots establish baselines/reconciliation checkpoints, never double-count units.
3. Produce quantity-by-date per account/instrument; invalidate on changed transaction activity.
4. Holdings views aggregate an instrument across accounts with a per-account breakdown (e.g. VAS at Vanguard and IBKR).

## Owned contracts and data

This feature owns its corresponding domain policies and primary records as described in [the PRD](../PRD.md). It must scope domain records to workspace, retain provenance where imported, use shared schemas in `packages/contracts`, and expose typed interfaces to other features.

## Failure modes and edge cases

- Reject cross-workspace requests, including direct file/object access.
- Keep source records/audit history on soft deletion; never silently fabricate financial values.
- Surface unsupported imports, conflicts, and inconsistent input for explicit review.

## Acceptance criteria

- Buy five units increases the position by five.
- Same trade on overlapping statements affects quantity once.

## Testing notes

- Add domain unit tests, integration tests with PostgreSQL where persistence is involved, and one end-to-end user-path test.
- Exercise source replay, idempotence, and negative authorisation paths where relevant.

## Interactions with **all** other registered features

**Rule:** Every new feature must be added to this table, even if its relationship is `None`. Reciprocal documentation must be updated in the other feature.

| Other feature | Interaction | Direction / contract |
|---|---|---|
| [Core / Workspaces](00-core-workspaces.md) | Integration | Position snapshots and computed holdings are isolated by workspace and account. |
| [Authentication](01-authentication.md) | None | No direct interaction in v0.2; review if either feature changes scope. |
| [Financial Accounts](02-financial-accounts.md) | Integration | Investment positions are keyed by both financial account and instrument. |
| [Source Files / Statements](03-source-files-statements.md) | None | No direct interaction in v0.2; review if either feature changes scope. |
| [Import Processing](04-import-processing.md) | Integration | After trade statement posting, affected position histories are recalculated idempotently. |
| [Transactions](05-transactions.md) | Integration | Investment transactions create quantity movements; restored/deactivated trades recalculate holdings. |
| [Events and Legs](06-events.md) | Integration | Investment event legs emit signed quantity movements for tracked instruments. |
| [Reconciliation](07-reconciliation.md) | Integration | Transfer links and manual investment decisions may change quantity movement interpretation. |
| [Financial Instruments](08-instruments.md) | Integration | Holdings key by canonical instrument, account, workspace, and effective date. |
| [Asset Price History](09-asset-price-history.md) | Integration | Dated unit prices combine with the independently derived dated unit counts. |
| [Valuation and FX](11-valuation-fx.md) | Integration | Units as-of each date multiply by the appropriate dated unit price. |
| [Manual Accounts](12-manual-accounts.md) | None | No direct interaction in v0.2; review if either feature changes scope. |
| [Financial Dashboard](13-dashboard.md) | Integration | Renders dated units held and contributions through quantity changes. |
| [Categories and Sankey](14-categories.md) | None | No direct interaction in v0.2; review if either feature changes scope. |

## Changes requiring reciprocal documentation

On creation or modification of a feature, amend this interaction table and corresponding rows in each linked feature document. A new feature requires an entry in **every existing feature file**. Also review its acceptance criteria, PRD scope, ADR decisions, and glossary.
