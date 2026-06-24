# Categories Feature

## Summary
Manages the hierarchical category taxonomy used to classify transaction legs and line items. Categories are self-referential (parent/child tree). The transactions feature stores category assignments as soft references (nullable text, no FK) so categories can be toggled off without a schema migration.

## Tables owned
| Table | Purpose |
|-------|---------|
| `categories` | Hierarchical category tree (self-referential via `parentId`) |

## Nav
Registers: **Categories** → `/categories`

## Cross-feature dependencies
- **core** — workspace context (`categories.workspaceId` → `workspaces.id`)

## Toggle
Can be disabled by removing `import '~/features/categories'` from `src/features/index.ts`. The Categories nav link disappears. Existing `categoryId` values in legs/line_items are preserved (nullable columns, no FK to drop). The event drawer omits the category selector. The Sankey chart on the dashboard renders empty.

## Key files
- `schema.ts` — `categories` table definition
- `categories-page.tsx` — Server functions, loader (`categoriesLoader`), and `CategoriesPage` component
- `components/category-selector.tsx` — Drill-down popover for selecting a category; also exports `buildCategoryBreadcrumb`
