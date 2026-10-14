# Source Files / Statements

**Feature ID:** `source-files-statements`  
**Owner:** Feature team  
**Status:** Draft (PRD v0.2)

## Purpose and scope

Retain source PDF/CSV files in RustFS and manage their provenance and soft-delete state.

## User stories

- As a workspace owner, I want to use source files / statements so that I can manage accurate, traceable finances.

## Functional requirements

1. Upload statements only into a workspace and matching financial account.
2. Retain file and extracted rows on soft delete; deactivate their contribution without physical deletion.
3. Support upload checksums, file metadata, parser version, restoration and statement list.
4. Support source-file kinds: statement, price import (CSV) and receipt (image/PDF attached to a canonical transaction; not parsed in v1).

## Owned contracts and data

This feature owns its corresponding domain policies and primary records as described in [the PRD](../PRD.md). It must scope domain records to workspace, retain provenance where imported, use shared schemas in `packages/contracts`, and expose typed interfaces to other features.

## Failure modes and edge cases

- Reject cross-workspace requests, including direct file/object access.
- Keep source records/audit history on soft deletion; never silently fabricate financial values.
- Surface unsupported imports, conflicts, and inconsistent input for explicit review.

## Acceptance criteria

- Soft-deleting a statement removes only unsupported active contributions.
- Underlying file is retained and can be inspected by authorised owners.

## Testing notes

- Add domain unit tests, integration tests with PostgreSQL where persistence is involved, and one end-to-end user-path test.
- Exercise source replay, idempotence, and negative authorisation paths where relevant.

## Interactions with **all** other registered features

**Rule:** Every new feature must be added to this table, even if its relationship is `None`. Reciprocal documentation must be updated in the other feature.

| Other feature | Interaction | Direction / contract |
|---|---|---|
| [Core / Workspaces](00-core-workspaces.md) | Integration | All source files, RustFS object keys, and statement records are workspace-scoped. |
| [Authentication](01-authentication.md) | Integration | Session-bound permissions protect PDF/CSV uploads and private RustFS downloads. |
| [Financial Accounts](02-financial-accounts.md) | Integration | Statements are attached to a specific institution account and validated against its identity. |
| [Import Processing](04-import-processing.md) | Integration | The worker reads authorised RustFS source objects and writes parsed staging/source rows. |
| [Transactions](05-transactions.md) | Integration | Transaction-source join rows preserve overlap, restoration and statement deletion semantics. |
| [Events and Legs](06-events.md) | None | No direct interaction in v0.2; review if either feature changes scope. |
| [Reconciliation](07-reconciliation.md) | None | No direct interaction in v0.2; review if either feature changes scope. |
| [Financial Instruments](08-instruments.md) | None | No direct interaction in v0.2; review if either feature changes scope. |
| [Asset Price History](09-asset-price-history.md) | Integration | Price CSV files are preserved as evidence; soft deletion deactivates unsupported price observations. |
| [Investment Holdings](10-holdings.md) | None | No direct interaction in v0.2; review if either feature changes scope. |
| [Valuation and FX](11-valuation-fx.md) | None | No direct interaction in v0.2; review if either feature changes scope. |
| [Manual Accounts](12-manual-accounts.md) | None | No direct interaction in v0.2; review if either feature changes scope. |
| [Financial Dashboard](13-dashboard.md) | Integration | Shows import/data completeness issues caused by missing or inactive source files. |
| [Categories and Sankey](14-categories.md) | None | No direct interaction in v0.2; review if either feature changes scope. |

## Changes requiring reciprocal documentation

On creation or modification of a feature, amend this interaction table and corresponding rows in each linked feature document. A new feature requires an entry in **every existing feature file**. Also review its acceptance criteria, PRD scope, ADR decisions, and glossary.
