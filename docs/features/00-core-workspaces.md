# Core / Workspaces

**Feature ID:** `core-workspaces`  
**Owner:** Feature team  
**Status:** Draft (PRD v0.2)

## Purpose and scope

Workspace creation, data boundaries, user-to-workspace ownership and initial single-member policy.

## User stories

- As a workspace owner, I want to use core / workspaces so that I can manage accurate, traceable finances.

## Functional requirements

1. On initial successful sign-up, create a default workspace and one owner membership.
2. Every financial resource and import job carries workspace_id; enforce it at service and query boundaries.
3. Do not expose invitations, member management, or collaboration in v1.

## Owned contracts and data

This feature owns its corresponding domain policies and primary records as described in [the PRD](../PRD.md). It must scope domain records to workspace, retain provenance where imported, use shared schemas in `packages/contracts`, and expose typed interfaces to other features.

## Failure modes and edge cases

- Reject cross-workspace requests, including direct file/object access.
- Keep source records/audit history on soft deletion; never silently fabricate financial values.
- Surface unsupported imports, conflicts, and inconsistent input for explicit review.

## Acceptance criteria

- First sign-in creates exactly one default workspace and owner membership.
- Requests for another workspace’s files/accounts/prices are rejected.

## Testing notes

- Add domain unit tests, integration tests with PostgreSQL where persistence is involved, and one end-to-end user-path test.
- Exercise source replay, idempotence, and negative authorisation paths where relevant.

## Interactions with **all** other registered features

**Rule:** Every new feature must be added to this table, even if its relationship is `None`. Reciprocal documentation must be updated in the other feature.

| Other feature | Interaction | Direction / contract |
|---|---|---|
| [Authentication](01-authentication.md) | Integration | Verified Better Auth identity resolves the single default owner workspace. |
| [Financial Accounts](02-financial-accounts.md) | Integration | Workspaces own accounts; every account read/write is authorised against the active workspace. |
| [Source Files / Statements](03-source-files-statements.md) | Integration | All source files, RustFS object keys, and statement records are workspace-scoped. |
| [Import Processing](04-import-processing.md) | Integration | Job payloads and SSE subscriptions must carry verified workspace context. |
| [Transactions](05-transactions.md) | Integration | Canonical transaction queries and uniqueness scopes include the workspace boundary. |
| [Events and Legs](06-events.md) | Integration | Financial event/leg generation and timeline queries never cross workspaces. |
| [Reconciliation](07-reconciliation.md) | Integration | Automatic candidates and manual review decisions are restricted to a workspace. |
| [Financial Instruments](08-instruments.md) | Integration | Instrument identity mappings and workspace-specific user choices remain isolated. |
| [Asset Price History](09-asset-price-history.md) | Integration | Each price series and its source-row choices are isolated within a workspace. |
| [Investment Holdings](10-holdings.md) | Integration | Position snapshots and computed holdings are isolated by workspace and account. |
| [Valuation and FX](11-valuation-fx.md) | Integration | Reporting currency, FX selection and valuation aggregation run inside workspace scope. |
| [Manual Accounts](12-manual-accounts.md) | Integration | Manual property/vehicle/debt entries belong to a workspace and cannot leak. |
| [Financial Dashboard](13-dashboard.md) | Integration | Dashboard aggregates only balances, events, holdings and manual inputs for its workspace. |
| [Categories and Sankey](14-categories.md) | Integration | Category tree and category decisions are workspace-scoped. |

## Changes requiring reciprocal documentation

On creation or modification of a feature, amend this interaction table and corresponding rows in each linked feature document. A new feature requires an entry in **every existing feature file**. Also review its acceptance criteria, PRD scope, ADR decisions, and glossary.
