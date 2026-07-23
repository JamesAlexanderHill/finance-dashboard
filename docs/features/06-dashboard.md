# Dashboard

## Summary

The dashboard feature is the primary view of the app: a snapshot of net worth plus interactive
balance-history and spending visualizations aggregated across all accounts and instruments in
the active workspace, and the timeline annotations that overlay them.

## Goals

- Show total net worth (home-currency instruments only, to avoid unreliable cross-currency
  conversion in the headline number).
- Provide one balance histogram component hosting four interchangeable views (line/area,
  stacked area, category bar, Sankey) sharing one date-range and period control.
- Let users mark significant dates (paydays, tax events, …) as annotations overlaid on the
  balance charts.

## Non-goals

- This feature does not own category or relation data — it consumes both (via their public
  contracts / the shared schema) to compute spending analytics; see
  [categories](03-categories.md) and [relations](04-relations.md).
- Exact visual styling (colors, spacing) is not specified here beyond what's needed to explain
  the account-color-to-chart-shade mapping, which is a functional requirement (color
  continuity conveys account/instrument relationships).

## Domain terminology

See the [glossary](../glossary.md): **account**, **instrument**, **category**, **relation**.

## Functional requirements

### Layout

Net Worth card, Balance Histogram, and a responsive grid of account cards (per-account
holdings by instrument, color-coded).

### Balance Histogram views

- **Line/area** — balance of one or more instruments over time, converted to home currency;
  projected (no-activity) segments render dashed; toggle series via legend checkboxes.
- **Stacked area** — combined balance stacked by account/instrument; `net` (debts below zero,
  assets above) or `separated` (gross totals) stack modes.
- **Category bar** — spending grouped by root category, bucketed by period; income categories
  listed before expense categories.
- **Sankey** — income sources flowing through expense categories for the selected range; a
  virtual `__income__` node consolidates multiple income roots, and a `__savings__` node
  appears when income exceeds expense. Period granularity is disabled in this view (it always
  covers the full selected range).

### Timeline annotations

One-time (single vertical line), range (shaded band), or recurring (weekly, fortnightly,
monthly, start/end of month, yearly) markers, workspace- and account-scoped, toggleable via a
legend below the chart.

## Responsibilities

- Net-worth, balance-history, category-spending, and Sankey computation.
- The balance histogram and chart components, and the annotation domain logic (recurrence expansion).

## Public contracts

`~/features/dashboard`:

- `sankeyService.getData` — types `SankeyData`, `SankeyNode`, `SankeyLink`.
- `categorySpendingService.getByPeriod` — types `CategoryInfo`, `CategoryBarDatum`, `CategoryBarData`.
- `annotationService` — `listByAccount`, `listByWorkspace`, `getById`, `create`, `update`, `delete`.
- `expandAnnotations` — pure recurrence-expansion function. Types: `AnnotationForExpansion`, `ExpandedAnnotation`.
- UI: `BalanceHistogram`, chart primitives re-exported from `./ui/charts` (`LineAreaChart`,
  `StackedAreaChart`, `CategoryBarChart`, `SankeyChart`, and their color/type helpers).

## Dependencies

- **accounts** — `instrumentService` for balances and balance history.
- **relations** — `relationService.getAnalyticsRelations()` to net transfers/reimbursements/refunds
  out of spending totals before aggregating (see
  [relations → effect on analytics](04-relations.md#effect-on-analytics)).

Category data itself is read directly from the shared schema (an analytics-scale join, not
routed through `categoryService`) rather than declared as a feature dependency.

## Interactions with other features

The dashboard route (`/`) and the account detail route both render `BalanceHistogram`. The
account-color palette (`~/shared/utilities/chart-colors`) is shared with
[accounts](01-accounts.md)' account color picker, so a color chosen there is consistent here.

## Authorization and permissions

All computations are scoped by `RequestContext.workspaceId`.

## Data ownership

`timeline_annotations`. Reads (does not own) `accounts`, `instruments`, `legs`, `events`,
`categories`, `event_relations`.

## Failure modes

- No instruments matching the user's home currency → net worth shows as unavailable/zero
  rather than an unreliable converted figure.
- A category or account with no activity in the selected range simply doesn't appear in that
  view's legend/nodes.

## Acceptance criteria

- Net worth excludes any instrument whose ticker isn't the user's home currency.
- Toggling an annotation off hides all its occurrences from both the line and stacked-area charts.
- Switching stack mode between `net` and `separated` does not change the underlying data, only
  its presentation.

## Open questions

- None currently.

## Related architectural decisions

- [ADR 0004 — Feature-oriented architecture](../adr/0004-feature-oriented-architecture.md)
