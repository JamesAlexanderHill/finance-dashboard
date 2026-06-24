# Transactions Feature

## Summary
The core financial data feature. Manages accounts, instruments (currencies/securities), events (transactions), legs (individual debit/credit entries), import file records, balance checkpoints, exchange rates, timeline annotations, and event relations.

## Tables owned
| Table | Purpose |
|-------|---------|
| `accounts` | Financial accounts (bank, brokerage, etc.) |
| `instruments` | Currencies/securities within an account |
| `events` | Transaction records (purchase, transfer, trade, etc.) |
| `legs` | Debit/credit entries within an event |
| `line_items` | Sub-entries within a leg (for detailed splits) |
| `files` | Import file run records |
| `instrument_checkpoints` | Monthly balance snapshots for fast history queries |
| `instrument_rates` | Exchange rates (instrument → home currency) |
| `timeline_annotations` | Labelled date markers on account charts |
| `event_relations` | Links between related events (e.g., transfer pairs) |

## Nav
Registers two nav links:
- **Accounts** → `/accounts`
- **Events** → `/events`

## Cross-feature dependencies
- **core** — workspace/user context
- **categories** (soft) — `legs.categoryId` and `line_items.categoryId` are nullable text columns with no DB FK constraint, so categories can be disabled without a schema migration. The event drawer will not show the category selector if categories are not loaded.

## Toggle
Can be disabled by removing `import '~/features/transactions'` from `src/features/index.ts`. Accounts and Events nav links disappear. The dashboard will show empty balances. Categories will still work (they have no FK dependency on transactions).

## Key files
- `schema.ts` — All table and enum definitions; `categoryId` columns use soft references (no FK)
- `components/event/event-drawer.tsx` — Global overlay for viewing/editing individual events
- `components/event/event-table.tsx` — Paginated event list with search/filter
- `components/event/event-preview-table.tsx` — Compact event preview used in import wizard
- `components/ImportWizard.tsx` — Single-account CSV/PDF import flow
- `components/BulkImportWizard.tsx` — Multi-account bulk import flow
- `components/instrument-card.tsx` — Per-instrument balance card
