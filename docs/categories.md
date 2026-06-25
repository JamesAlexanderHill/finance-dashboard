# Categories

Categories are user-defined labels attached to transaction legs (and their line items) to classify spending and income. They are organized into a hierarchical tree and are scoped to each workspace independently.

## Data Model

```
categories
  id          — UUIDv7
  workspaceId — references workspaces.id
  parentId    — self-referential FK to categories.id (NULL for root categories)
  name        — user-defined label
```

There are no timestamps on categories. The schema has no `createdAt` or `updatedAt` fields.

## Hierarchy

Categories form a tree via the self-referential `parentId` field. Root categories have `parentId = NULL`. There is no enforced depth limit, though the Sankey visualization expands the expense tree up to four levels deep.

Example tree:

```
Income
├── Salary
└── Dividends

Lifestyle
└── Food
    ├── Coffee
    ├── Groceries
    └── Dining

Essential
├── Transport
└── Housing
```

Categories are stored as a flat list and the tree is reconstructed client-side by filtering on `parentId`.

## Workspace Scoping

Every category belongs to exactly one workspace. Users in different workspaces have completely independent category trees. All service operations enforce workspace scoping — a user cannot read, modify, or delete categories outside their current workspace.

## CRUD

### Create

A new category is created with a name and an optional `parentId`. If `parentId` is NULL the category becomes a root. The parent must belong to the same workspace.

### Rename

Only the `name` field can be updated. The category's position in the hierarchy (its `parentId`) cannot be changed after creation.

### Delete

A category can only be deleted if it has no child categories. The delete order must be bottom-up (leaves first).

When a leaf category is deleted:
- All `legs` referencing that category have their `categoryId` set to `NULL`.
- All `lineItems` referencing that category have their `categoryId` set to `NULL`.
- The category row is removed.

Transaction history is preserved — events are not deleted, only their category tag is cleared.

### List

`categoryService.list()` returns all categories in the workspace as a flat array. Clients reconstruct the tree by filtering `parentId`.

## Attaching Categories to Transactions

Categories are attached at two levels:

**Leg level** — Each leg of an event can be tagged with one category. This covers most transactions (e.g. a salary deposit tagged to "Salary", or a coffee purchase tagged to "Coffee").

**Line item level** — A single leg can be split into multiple line items, each with its own category and amount. This is used for itemized transactions where one charge spans multiple spending categories (e.g. a supermarket leg split across "Groceries", "Produce", and "Dairy"). The sum of line item amounts equals the leg's total.

Categories can be assigned or changed at any time via the event drawer in the UI.

## Income vs. Expense Classification

Categories are not explicitly marked as income or expense. Classification is inferred at query time from the sign of the leg's `unitCount`:
- Positive `unitCount` → income
- Negative `unitCount` → expense

This means the same category tree supports both directions. Visualizations (Sankey, category bar chart) derive income vs. expense dynamically from the data.

## Categories in Imports

During CSV import, the `categoryAssignments` map can pre-assign categories using colon-separated paths (e.g. `"food:coffee"` resolves to the Coffee category under Food). Paths are matched case-insensitively by walking the category hierarchy. If a path does not resolve to a known category, the leg is imported with `categoryId = NULL` — no error is raised and the import proceeds.

## Spending Analysis

Categories are the foundation of two visualizations:

- **Category bar chart** — Buckets spending by root category over time (daily, weekly, or monthly periods). Non-categorized legs are excluded.
- **Sankey diagram** — Flows income sources through expense categories. Amounts are aggregated up to root categories by walking the `parentId` chain.

Both visualizations filter out legs where `categoryId IS NULL`.
