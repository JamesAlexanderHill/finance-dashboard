# Dashboard Feature

## Summary
The home page of the app. Displays net worth summary, a balance history histogram (per-instrument), and a cash flow Sankey chart broken down by category. Reads data from the transactions and categories features — it owns no DB tables itself.

## Tables owned
None.

## Nav
Registers: **Dashboard** → `/` (exact match)

## Cross-feature dependencies
- **transactions** — balance history, account/instrument data, timeline annotations
- **categories** — category-level Sankey breakdown (Sankey renders empty if categories disabled)

## Toggle
Can be disabled by removing `import '~/features/dashboard'` from `src/features/index.ts`. The `/` route will still exist but show no nav link. The dashboard reads from transactions/categories; disabling dashboard has no impact on those features.

## Key files
- `dashboard-page.tsx` — Server functions, loader (`dashboardLoader`), and `DashboardPage` component
- `components/balance-histogram.tsx` — Multi-instrument balance history chart with annotations, Sankey, and category bar chart
- `schema.ts` — Empty (no owned tables)
