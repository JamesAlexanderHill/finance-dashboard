# Categories and Cash-Flow Sankey

**Feature ID:** `categories`  
**Owner:** Feature team  
**Status:** Draft (PRD v0.2)

## Purpose and scope

User-defined category tree, manual leg categorisation, and the income/expense Sankey diagram.

## User stories

- As a workspace owner, I want to categorise every income and expense leg so that I can see where money comes from and where it goes.
- As a workspace owner, I want a Sankey diagram of a selected period's cash flow so that I can see how income was spent across Savings, Essentials and Lifestyle and how much is left over.
- As a workspace owner, I want deep categories (e.g. `Essentials > Groceries > Milk`, `Savings > Vanguard > Fees`) so that I can see exactly how much went to one thing in a period.

## Functional requirements

1. Category tree of arbitrary depth with four fixed top-level categories: **Income** (kind `income`), **Savings**, **Essentials** and **Lifestyle** (kind `expense`). Child categories are user-editable.
2. Every income/expense leg, including fee/tax/interest legs on internal events and line-item legs from itemisation, has exactly one category; default *Uncategorised*.
3. **Categories track spending behaviour, not where money sits.** Categories are assigned to event legs as the user sees them (e.g. a Vanguard brokerage fee leg → `Savings > Vanguard > Fees`). Savings can contain unbalanced legs such as investment fees. Whether money left net worth is determined by the event, never by category.
   - **Internal events are hidden from the Sankey.** Transfer, conversion and trade principal legs (including ETF purchases) never appear; only unbalanced legs (income, expenses, fees, tax, interest) do.
   - **Tags.** A leg may carry zero or more tags (e.g. `Europe 2024`), independent of its category and stored as decisions the same way. Every Sankey, cash-flow and expense chart can be filtered by tag.
4. No automatic or default categorisation in v1; every leg starts *Uncategorised*. Any leg can be recategorised; because events are rebuilt, the assignment is stored as a decision keyed on the leg's stable identity (canonical transaction ID plus leg role/line index), so it survives event rebuilds.
   - **Bulk categorisation stays manual.** The user may select many legs (e.g. every uncategorised transaction matching a search) and give them one category in one step. Each leg still gets its own decision, exactly as if categorised alone; no rule is stored and later imports still start *Uncategorised*. Internal principal legs are skipped, and itemised transactions are categorised line by line.
   - **Categorise similar transactions.** Choosing a category for a leg first lists other active transactions that look like it, in three sections: *Identical* (uncategorised, same description ignoring case, spacing and punctuation; ticked by default), *Similar* (uncategorised, same normalised description with digits also ignored, or the same first word of it when that word has three or more letters, so "WOOLWORTHS 1234 SYDNEY" and "WOOLWORTHS 5678 NEWTOWN" match; unticked) and *Already categorised* (identical or similar but in a different category; unticked, showing its category). Nothing is saved until the user applies the category; the leg and every ticked leg then get one ordinary decision each, as in bulk categorisation. Legs already in the chosen category, internal principal legs, line items and the leg itself are not listed; with nothing to list, the category is saved at once.
   - **Suggestions, not rules.** An uncategorised leg is *suggested* the category of the most recently categorised leg whose transaction has the same normalised description (case, digits and punctuation ignored). A suggestion is derived from earlier decisions when read, never stored and never counted: the leg stays *Uncategorised* until the user accepts it, singly or many at once, which records an ordinary category decision.
5. Refunds are negative expense in the linked original purchase's category, or a user-chosen one; never income.
6. Sankey visualises one selected period's cash flow: income-kind categories flow in from the left; Savings, Essentials and Lifestyle flow out to the right. Income not consumed by unbalanced outflows remains as a visible *Unallocated* node (e.g. 10k income, 9k out → 1k unallocated), so Unallocated always equals the period's net cash flow; outflows exceeding income appear as *Drawn from savings* on the income side. *Uncategorised* income and expense appear as visible nodes; selecting one lists the uncategorised legs for that period.
7. The Sankey shows top-level categories plus one child level by default; selecting a node drills into its subtree.
8. Non-AUD legs are shown in the reporting currency using dated FX; legs without an available rate are flagged rather than converted 1:1.

## Owned contracts and data

`categories` (tree, kind, fixed top-level flag), `tags`, and category/tag decisions. Scoped to workspace; uses shared schemas in `packages/contracts`.

## Failure modes and edge cases

- Reject cross-workspace requests.
- Top-level categories cannot be deleted or have their kind changed.
- Deleting a child category requires reassigning its legs (to the parent or another category), and is unavailable while it still has subcategories.
- Recategorising a leg whose transaction becomes inactive keeps the decision for restoration.

## Acceptance criteria

- Every income/expense leg in a period appears exactly once in the Sankey.
- Internal transfers, conversions and trades contribute only their fee/tax/interest legs.
- A recategorisation survives soft deletion and reimport of the underlying statement.
- Categorising selected legs together records one decision per changed leg and leaves future imports *Uncategorised*.
- Categorising "Corner Grocer 1234" pre-ticks another "CORNER GROCER #1234", offers "Corner Grocer 5678" unticked and "Corner Grocer 99" (already Lifestyle) unticked, and records decisions only for the legs that were ticked.
- A newly imported "CORNER GROCER 5678" is suggested the category last given to "Corner Grocer 1234", stays *Uncategorised* in every total, and is categorised only once the suggestion is accepted.

## Testing notes

- Domain unit tests for category resolution and Sankey aggregation; PostgreSQL integration tests for decision persistence across rebuilds; one end-to-end categorise-and-view test.

## Interactions with **all** other registered features

**Rule:** Every new feature must be added to this table, even if its relationship is `None`. Reciprocal documentation must be updated in the other feature.

| Other feature | Interaction | Direction / contract |
|---|---|---|
| [Core / Workspaces](00-core-workspaces.md) | Integration | Category tree and category decisions are workspace-scoped. |
| [Authentication](01-authentication.md) | None | No direct interaction in v0.2; review if either feature changes scope. |
| [Financial Accounts](02-financial-accounts.md) | None | No direct interaction in v0.2; review if either feature changes scope. |
| [Source Files / Statements](03-source-files-statements.md) | None | No direct interaction in v0.2; review if either feature changes scope. |
| [Import Processing](04-import-processing.md) | None | No direct interaction in v0.2; imports never assign categories. |
| [Transactions](05-transactions.md) | Integration | Category and itemisation decisions are keyed on canonical transaction IDs (plus line index). |
| [Events and Legs](06-events.md) | Integration | Event projection applies category decisions to income/expense legs; internal events expose only fee/tax/interest legs for categorisation. |
| [Reconciliation](07-reconciliation.md) | Integration | Refund-to-purchase links supply the refund's default category; category decisions share the decision store. |
| [Financial Instruments](08-instruments.md) | None | No direct interaction in v0.2; review if either feature changes scope. |
| [Asset Price History](09-asset-price-history.md) | None | No direct interaction in v0.2; review if either feature changes scope. |
| [Investment Holdings](10-holdings.md) | None | No direct interaction in v0.2; review if either feature changes scope. |
| [Valuation and FX](11-valuation-fx.md) | Integration | Dated FX converts non-AUD legs for Sankey totals; missing rates are flagged. |
| [Manual Accounts](12-manual-accounts.md) | None | No direct interaction in v0.2; review if either feature changes scope. |
| [Financial Dashboard](13-dashboard.md) | Integration | Dashboard income/expense totals and the Sankey aggregate legs by top-level category kind. |

## Changes requiring reciprocal documentation

On creation or modification of a feature, amend this interaction table and corresponding rows in each linked feature document. A new feature requires an entry in **every existing feature file**. Also review its acceptance criteria, PRD scope, ADR decisions, and glossary.
