# Dev Tools

## Summary

The dev-tools feature is a development-only control panel (`/dev`) for seeding, inspecting,
resetting, and snapshotting workspace data. It is never registered outside development — see
`src/app/features.ts`, which only includes it when `import.meta.env.DEV` is true.

## Goals

- Give developers a one-click way to seed demo users/workspaces and a realistic sample dataset.
- Provide a destructive-but-safe way to wipe data during local development and e2e test setup.
- Let developers capture and restore a workspace's entire data graph as a portable JSON
  snapshot, for saving known-good fixtures or rolling back after experiments.

## Non-goals

- This feature is not part of any production build's feature set — it must never be relied on
  for real user-facing functionality.
- It does not add new business rules; every mutation goes through the same services (or, for
  bulk seed/wipe operations, the same shared schema) the real features use.

## Domain terminology

See the [glossary](../glossary.md). No new domain terms — this feature operates on every
other feature's data model directly.

## Functional requirements

### Access and safety

The sidebar link and `/dev` route render only in dev mode. Every server function independently
calls `requireDevSession()` (an authenticated session), since they're callable directly over
HTTP, not just from the gated page. There are no confirmation dialogs — a warning banner
reiterates that every action is destructive or irreversible.

### Status panel

Current user/workspace, and row counts (accounts, events, legs, checkpoints, rates) for the
active workspace, refreshed after every action.

### Data management actions

| Action                        | Effect                                                                                                                                                                                                       |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Seed base                     | Demo User A + B (each with a personal workspace) plus a shared "Joint Finances" workspace. No-op if users already exist.                                                                                     |
| Seed sample events            | ~30 events across 4 accounts/7 instruments/12 categories, covering every event type, multi-leg events, line items, a transfer pair, a simulated import file, and annotations. No-op if events already exist. |
| Clear all data                | Deletes everything, across all users/workspaces, in FK-dependency order.                                                                                                                                     |
| Recompute checkpoints / rates | Rebuilds every instrument's checkpoints / transaction-derived rates (manual rates preserved).                                                                                                                |
| Create additional user        | Ad hoc user + personal workspace for scenarios beyond the two demo users.                                                                                                                                    |

### Canonical CSV quick import

Loads a CSV already in [canonical format](05-imports.md#canonical-format) straight into an
account, reusing the normal commit path (instrument auto-resolution, `files` row with
`parserId: 'canonical'`, standard deduplication) — a fast way to reload a fixture.

### Workspace snapshots (export/import)

- **Export** — serializes every workspace-scoped table to JSON (`bigint` columns as strings,
  `Date` columns as ISO strings), downloaded as `snapshot-<workspace>-<date>.json`.
- **Import** — validates the file's format version and table list, wipes the target
  workspace's current data (`clearWorkspaceData`), then reinserts every row inside one
  transaction, remapping `workspaceId` to the current workspace while preserving all other ids
  and dedupe keys. Two circular/self-referential FKs (`accounts.defaultInstrumentId`,
  `categories.parentId`) are handled with a null-then-update pass. Derived tables
  (checkpoints, rates) are restored verbatim, not recomputed, so manual rates survive a round trip.
- A snapshot can be restored into its original workspace or any other workspace. Because the
  wipe and reinsert share one transaction, a failure (e.g. the source workspace's rows still
  exist elsewhere, colliding on a global unique key) rolls back cleanly.

## Responsibilities

- Seeding and clearing demo/test data.
- Workspace snapshot export/import.
- The `/dev` page and its server functions.

## Public contracts

`~/features/dev-tools`:

- `seedBase`, `seedSampleEvents`, `clearAllData`, `clearWorkspaceData` (also used inside the
  snapshot import transaction). Type: `SeedResult`, `DbOrTx`.
- `exportWorkspaceSnapshot`, `importWorkspaceSnapshot`. Types: `WorkspaceSnapshot`, `ImportCounts`.

## Dependencies

Conceptually depends on every other business feature (accounts, transactions, categories,
relations, imports) being registered, since it seeds/clears their data — declared in
`src/features/dev-tools/feature.ts`'s `dependencies` even though it operates on the shared
database schema directly rather than importing their service layers.

## Interactions with other features

`seedBase` calls `~/core/workspaces`' `createUserWithPersonalWorkspace`. The recompute actions
call [accounts](01-accounts.md)' `checkpointService.refreshAll`/`rateService.refreshAll`. The
canonical-CSV quick import reuses [imports](05-imports.md)' `importService.commitImport`.

## Authorization and permissions

Every server function requires an authenticated session (`requireDevSession`); beyond that,
there is no additional role check — any signed-in user can wipe or seed data when this feature
is registered, which is why it must never ship to production.

## Data ownership

None of its own — it reads and writes every other feature's tables directly.

## Failure modes

- Seeding when data already exists is a no-op with a message, not an error.
- A snapshot import that fails (e.g. a global unique-key collision) rolls back entirely,
  leaving the target workspace untouched.

## Acceptance criteria

- Exporting a workspace, clearing it, then importing the export reproduces every table's rows
  and every `bigint`/`Date` value exactly, including a rollback-safe failure path (covered by
  an integration test that auto-skips when `DATABASE_URL` is unset).
- This feature is absent from `getAppFeatures()`'s result outside development.

## Open questions

- None currently.

## Related architectural decisions

- [ADR 0004 — Feature-oriented architecture](../adr/0004-feature-oriented-architecture.md)
