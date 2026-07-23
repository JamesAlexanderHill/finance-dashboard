# Categories

## Summary

The categories feature owns the workspace's hierarchical category tree, used to classify
spending and income on legs and line items, plus the widgets used to assign categories in bulk
and pick a category anywhere else in the app.

## Goals

- Represent categories as a self-referential tree (`parentId`), scoped independently per workspace.
- Let any leg or line item be tagged with a category, changeable at any time.
- Infer income vs. expense from the sign of the tagged leg's amount rather than storing a
  separate flag — the same tree supports both directions.

## Non-goals

- Deciding how categorized data is visualized — that's [dashboard](06-dashboard.md)'s spending
  analytics (category bar chart, Sankey), which consume category data but don't own it.
- Netting transfers/reimbursements out of spending totals — that's
  [relations](04-relations.md)' concern, applied by the dashboard before aggregation.

## Domain terminology

See the [glossary](../glossary.md): **category**.

## Functional requirements

- A category has a `name` and an optional `parentId` (`null` = root). No enforced depth limit
  (though the Sankey visualization only expands four levels).
- No timestamps — categories have no `createdAt`/`updatedAt`.
- **Create**: name + optional parent (must be in the same workspace).
- **Rename**: only `name` can change; a category's position in the hierarchy is fixed at creation.
- **Delete**: only allowed with no child categories (bottom-up); on delete, referencing legs
  and line items have their `categoryId` cleared (transaction history is preserved, only the
  tag is removed).
- **List**: returns the full flat array for the workspace; clients reconstruct the tree by
  filtering `parentId`.
- During import, `categoryAssignments` can pre-assign categories via colon-separated paths
  (e.g. `food:coffee`), matched case-insensitively; an unresolvable path leaves the leg
  uncategorized rather than erroring.

## Responsibilities

- Category CRUD, scoped to the caller's workspace.
- The category selector and bulk category-assignment widget UI used by transactions and imports.

## Public contracts

`~/features/categories`:

- `categoryService` — `list`, `create`, `rename`, `remove`.
- UI: `CategorySelector`, `buildCategoryBreadcrumb`, `CategoryAssignWidget`.

## Dependencies

None — depends only on the core platform.

## Interactions with other features

- **Transactions**' event drawer and tables use `CategorySelector` to tag legs, and
  `CategoryAssignWidget` for bulk-assigning categories to uncategorized/similar events (which
  in turn calls into `eventService`).
- **Imports** resolves `categoryAssignments` paths against `categoryService.list()`.
- **Dashboard**'s category-spending and Sankey services query the `categories` table directly
  (an analytics-scale concern) and combine it with relation data — see
  [relations → effect on analytics](04-relations.md#effect-on-analytics).

## Authorization and permissions

All operations are scoped by `RequestContext.workspaceId`.

## Data ownership

`categories`.

## Failure modes

- Deleting a category with children throws rather than cascading.
- An import's category path that doesn't resolve leaves the leg's `categoryId` null; the
  import proceeds without error.

## Acceptance criteria

- Deleting a leaf category clears `categoryId` on every leg/line item that referenced it, and
  preserves those events otherwise unchanged.
- The same category tree correctly separates income and expense totals purely from leg sign.

## Open questions

- None currently.

## Related architectural decisions

- [ADR 0004 — Feature-oriented architecture](../adr/0004-feature-oriented-architecture.md)
