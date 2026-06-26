# Dev Tools

The `/dev` page is a development-only control panel for seeding, inspecting, and resetting workspace data. It is hidden outside dev mode and every action is destructive or irreversible, so it never ships to production use. This document covers the page's status panel, its data-management actions, and the workspace snapshot export/import.

## Access and Safety

- The sidebar link and the `/dev` route render only when `import.meta.env.DEV` is true, so the page is invisible in production builds.
- Each action is a server function that calls `requireDevSession()` before doing anything. The server functions are callable directly over HTTP — not just from the gated page — so they independently require an authenticated session.
- Actions mutate or wipe data directly, with no confirmation dialogs. A warning banner at the top of the page reiterates that everything here is destructive.

## Status Panel

Two cards at the top of the page summarize the current state:

- **User / Workspace** — the current user's name, the active workspace name, and the user ID.
- **Data counts** — row counts for the current workspace: accounts, events, legs, checkpoints, and rates.

The counts are loaded by the `getDevStatus` server function and refresh after every action (the route invalidates its loader on completion).

## Data Management Actions

| Action | Effect |
|--------|--------|
| **Seed base** | Creates Demo User A and Demo User B, each with a personal workspace, plus a shared "Joint Finances" workspace (A as owner, B as member). No-op if any users already exist. |
| **Seed sample events** | Populates the shared workspace with 4 accounts, 7 instruments, 12 categories, and ~30 events spanning Aug 2025–May 2026 — covering every event type, multi-leg events, line items, transfer pairs, a simulated import file, and timeline annotations. Requires a shared workspace; no-op if events already exist. |
| **Clear all data** | Deletes everything — across all users and workspaces — in foreign-key dependency order. |
| **Recompute checkpoints** | Rebuilds the monthly balance checkpoints for every instrument. |
| **Recompute rates** | Rebuilds transaction-derived exchange rates for every instrument. Manually entered rates are preserved. |
| **Create additional user** | A small form (name, email, home currency) that creates a new user with their own personal workspace, for testing scenarios beyond the two demo users. |

Seeding and clearing are backed by `seedBase()`, `seedSampleEvents()`, and `clearAllData()`; the recompute actions call `checkpointService.refreshAll()` and `rateService.refreshAll()`.

## Workspace Snapshots (Export / Import)

The **"Export / import workspace snapshot"** card captures the current workspace's entire data graph as a JSON file and restores it later. Use it to save a known-good setup before destructive testing, roll back after experiments, or move a fixture between environments.

### Export

"Export snapshot" downloads a file named `snapshot-<workspace>-<date>.json`. `exportWorkspaceSnapshot()` reads every workspace-scoped table and serializes it to plain JSON. Two column types are converted because JSON cannot represent them natively:

- `bigint` columns (leg and line-item `unitCount`, checkpoint `balance`) → strings
- `Date` columns (all timestamps) → ISO 8601 strings

The snapshot captures every workspace-scoped table:

```
accounts, instruments, categories, files, events, legs, lineItems,
instrumentCheckpoints, instrumentRates, timelineAnnotations, eventRelations
```

`eventRelations` (see [Relations](./6-relations.md)) is the only one with no `workspaceId` column, so it is scoped indirectly via the workspace's events.

### Snapshot Format

```
version      — format version (currently 1), checked on import
exportedAt   — ISO timestamp of when the snapshot was taken
workspace    — { name } of the source workspace, for reference only
<table>      — one array per captured table (accounts, instruments, events, …)
```

### Import / Restore

"Import snapshot" opens a file picker; the chosen file is read and JSON-parsed in the browser, then handed to `importWorkspaceSnapshot()`, which runs entirely inside one database transaction:

1. **Validate** — reject the file unless `version` is 1 and every expected table array is present.
2. **Wipe** — delete the current workspace's existing rows in dependency order (`clearWorkspaceData`).
3. **Reinsert** — insert every row in foreign-key dependency order, remapping each row's `workspaceId` to the current workspace while preserving all other IDs and dedupe keys. `bigint` and `Date` values are converted back from their string form.

Two structural foreign keys are handled with a null-then-update pass:

- `accounts.defaultInstrumentId` (circular: accounts ↔ instruments) — accounts insert with a null default, which is set once the instruments exist.
- `categories.parentId` (self-referential) — categories insert flat, then each parent link is set.

Derived tables (`instrumentCheckpoints`, `instrumentRates`) are restored verbatim rather than recomputed, so manually entered exchange rates survive a round trip exactly.

### Semantics and Caveats

- **Restore targets the current workspace.** Because every `workspaceId` is remapped, a snapshot can be restored into the workspace it came from or loaded into any other workspace.
- **IDs are preserved.** Since the import wipes the target workspace first, the normal restore path never collides. The one unsupported case is importing a snapshot while its *source* workspace's rows still exist elsewhere in the same database — primary-key and dedupe-key uniqueness is global, so the insert fails. Because the wipe and reinsert share one transaction, such a failure rolls back cleanly and the existing data is left untouched.

### Implementation

| Piece | Location |
|-------|----------|
| `exportWorkspaceSnapshot()`, `importWorkspaceSnapshot()`, and the `WorkspaceSnapshot` type | `src/lib/snapshot.ts` |
| `clearWorkspaceData()` — workspace-scoped wipe that runs inside the import transaction | `src/lib/seed.ts` |
| `devExportSnapshot` / `devImportSnapshot` server functions and the snapshot card UI | `src/routes/dev.tsx` |

A round-trip and rollback integration test lives in `src/lib/__tests__/snapshot.integration.test.ts`: it seeds a workspace, exports, clears, re-imports, and asserts that every table and the `bigint`/`Date` values survive — plus that a failed import rolls back without touching existing data. Like the other database tests, it auto-skips when `DATABASE_URL` is unset.
