# Import Processing

**Feature ID:** `import-processing`  
**Owner:** Feature team  
**Status:** Draft (PRD v0.2)

## Purpose and scope

Durable PostgreSQL job queue, independent Bun worker, staged parsing, SSE and retry handling.

## User stories

- As a workspace owner, I want to use import processing so that I can manage accurate, traceable finances.

## Functional requirements

1. Use jobs and append-only job_progress tables; claim with safe row-level locking.
2. Support PDF/CSV statement and daily-price CSV jobs as distinct job types.
3. Persist parse/validation outcomes and broadcast SSE with recovery cursor.
4. Use versioned parsers; idempotent retry and atomic financial commits.

## Owned contracts and data

This feature owns its corresponding domain policies and primary records as described in [the PRD](../PRD.md). It must scope domain records to workspace, retain provenance where imported, use shared schemas in `packages/contracts`, and expose typed interfaces to other features.

## Failure modes and edge cases

- Reject cross-workspace requests, including direct file/object access.
- Keep source records/audit history on soft deletion; never silently fabricate financial values.
- Surface unsupported imports, conflicts, and inconsistent input for explicit review.

## Acceptance criteria

- Worker restart recovers leased work safely.
- SSE reconnect reconstructs durable progress.
- Partial parse does not silently corrupt canonical tables.

## Testing notes

- Add domain unit tests, integration tests with PostgreSQL where persistence is involved, and one end-to-end user-path test.
- Exercise source replay, idempotence, and negative authorisation paths where relevant.

## Interactions with **all** other registered features

**Rule:** Every new feature must be added to this table, even if its relationship is `None`. Reciprocal documentation must be updated in the other feature.

| Other feature | Interaction | Direction / contract |
|---|---|---|
| [Core / Workspaces](00-core-workspaces.md) | Integration | Job payloads and SSE subscriptions must carry verified workspace context. |
| [Authentication](01-authentication.md) | Integration | SSE subscriptions and job status reads are authenticated, not just UI-gated. |
| [Financial Accounts](02-financial-accounts.md) | None | No direct interaction in v0.2; review if either feature changes scope. |
| [Source Files / Statements](03-source-files-statements.md) | Integration | The worker reads authorised RustFS source objects and writes parsed staging/source rows. |
| [Transactions](05-transactions.md) | Integration | Statement imports upsert canonical transactions and their source occurrence links idempotently. |
| [Events and Legs](06-events.md) | Integration | Successful transaction imports trigger event/leg posting or replay for affected records. |
| [Reconciliation](07-reconciliation.md) | Integration | Successful imports schedule affected-account deduplication and candidate reconciliation. |
| [Financial Instruments](08-instruments.md) | Integration | Provider-specific trade and price identifiers are resolved to canonical instruments. |
| [Asset Price History](09-asset-price-history.md) | Integration | Price CSV parse/validation runs through persistent jobs and streams progress. |
| [Investment Holdings](10-holdings.md) | Integration | After trade statement posting, affected position histories are recalculated idempotently. |
| [Valuation and FX](11-valuation-fx.md) | None | No direct interaction in v0.2; review if either feature changes scope. |
| [Manual Accounts](12-manual-accounts.md) | None | No direct interaction in v0.2; review if either feature changes scope. |
| [Financial Dashboard](13-dashboard.md) | Integration | Shows latest import status and invalidates affected queries after successful jobs. |
| [Categories and Sankey](14-categories.md) | None | No direct interaction in v0.2; imports never assign categories. |

## Changes requiring reciprocal documentation

On creation or modification of a feature, amend this interaction table and corresponding rows in each linked feature document. A new feature requires an entry in **every existing feature file**. Also review its acceptance criteria, PRD scope, ADR decisions, and glossary.
