# Financial Accounts

**Feature ID:** `financial-accounts`  
**Owner:** Feature team  
**Status:** Draft (PRD v0.2)

## Purpose and scope

Manage institutions and their single-commodity financial accounts, account types, balance observations, and user-visible account activity.

## User stories

- As a workspace owner, I want to use financial accounts so that I can manage accurate, traceable finances.

## Functional requirements

1. Create/edit/archive bank, credit, loan, investment, brokerage and payment-processing accounts. Archiving closes an account on a date the user picks (no earlier than its latest transaction or balance): it is hidden from lists and pickers but can still be opened, and unarchiving reopens it. A warning (never a block) shows when its last known balance is not zero.
2. Group accounts under institutions; each account holds exactly one commodity (currency or instrument). Multi-currency providers have one account per currency.
3. Auto-create unknown accounts found during import as *unconfirmed*; the user confirms or merges them.
4. Display statements, transactions, holdings, and reliable balance source/date. Each account has a page showing its current balance with the statement (or manual entry) and date it came from, every reported balance, its latest transactions, and the statements that name it or an account merged into it, including deleted ones. The accounts list shows, for each statement-backed account, a bar of the periods its live statements cover, drawn against the range from the earliest statement imported for any listed account to today, so gaps and accounts behind stand out; continuous statements show as one period, and hovering a period or a gap shows its start and end dates.
5. Merging an unconfirmed account into another account of the same institution and commodity (e.g. a reissued card) is reversible. Its statements keep naming it, but their transactions and balances belong to the target: a transaction moves with its ID and decisions, and a row the target already has joins the target's transaction. Statements imported later follow the merge. Unmerging restores the original transactions and their decisions.
6. An asset account (typically a manual property) can be paired with liability accounts (its loans) and offset accounts; each paired account belongs to at most one asset. The asset's page shows equity over time: value − (loans − offsets), each valued as in net worth on that date, with each input shown alongside. Pairing is display-only; net worth already counts every account once.

## Owned contracts and data

This feature owns its corresponding domain policies and primary records as described in [the PRD](../PRD.md). It must scope domain records to workspace, retain provenance where imported, use shared schemas in `packages/contracts`, and expose typed interfaces to other features.

## Failure modes and edge cases

- Reject cross-workspace requests, including direct file/object access.
- Keep source records/audit history on soft deletion; never silently fabricate financial values.
- Surface unsupported imports, conflicts, and inconsistent input for explicit review.

## Acceptance criteria

- Multiple accounts at one institution are distinct.
- Unknown balances are not inferred from incomplete history.
- An account with January and March statements shows two covered periods and a February gap on the accounts list; adding the February statement shows one period. An account whose last statement ends before today shows the days since as missing.
- An account's page names the statement or manual entry, and the date, its balance comes from; with no live statement reporting one, it says the balance is unknown.
- Merging then unmerging an account leaves its transactions, their IDs and decisions as they were.
- A $700k property paired with a $500k loan and a $50k offset shows $250k equity, and net worth is unchanged by the pairing.
- Archiving an account never changes net worth or cash flow on dates before its closing date.

## Testing notes

- Add domain unit tests, integration tests with PostgreSQL where persistence is involved, and one end-to-end user-path test.
- Exercise source replay, idempotence, and negative authorisation paths where relevant.

## Interactions with **all** other registered features

**Rule:** Every new feature must be added to this table, even if its relationship is `None`. Reciprocal documentation must be updated in the other feature.

| Other feature | Interaction | Direction / contract |
|---|---|---|
| [Core / Workspaces](00-core-workspaces.md) | Integration | Workspaces own accounts; every account read/write is authorised against the active workspace. |
| [Authentication](01-authentication.md) | Integration | Session middleware authorises financial account commands and reads. |
| [Source Files / Statements](03-source-files-statements.md) | Integration | Statements are attached to a specific institution account and validated against its identity. |
| [Import Processing](04-import-processing.md) | Integration | Imports route rows naming a merged account to the account it was merged into. |
| [Transactions](05-transactions.md) | Integration | Each canonical transaction references the owned financial account whose statement supplied it. |
| [Events and Legs](06-events.md) | Integration | Account-aware money legs link multi-account transfers into one economic activity. |
| [Reconciliation](07-reconciliation.md) | Integration | Account identity, currency and balance direction constrain transfer candidate matching. |
| [Financial Instruments](08-instruments.md) | None | No direct interaction in v0.2; review if either feature changes scope. |
| [Asset Price History](09-asset-price-history.md) | None | No direct interaction in v0.2; review if either feature changes scope. |
| [Investment Holdings](10-holdings.md) | Integration | Investment positions are keyed by both financial account and instrument. |
| [Valuation and FX](11-valuation-fx.md) | Integration | Dated cash balances and account currencies provide native-currency valuation inputs; a property's equity uses the same dated values. |
| [Manual Accounts](12-manual-accounts.md) | Integration | Tracked account balances must not be counted again as separate manually valued assets; a manual property can be paired with tracked loans and offsets to show its equity. |
| [Financial Dashboard](13-dashboard.md) | Integration | Aggregates dated native-currency balances and identifies unavailable account data. |
| [Categories and Sankey](14-categories.md) | None | No direct interaction in v0.2; review if either feature changes scope. |

## Changes requiring reciprocal documentation

On creation or modification of a feature, amend this interaction table and corresponding rows in each linked feature document. A new feature requires an entry in **every existing feature file**. Also review its acceptance criteria, PRD scope, ADR decisions, and glossary.
