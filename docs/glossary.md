# Personal Finance

A personal finance app that imports statements from the user's institutions, turns them into economic events, and reports cash flow, holdings and net worth with full provenance.

## Language

### Ownership

**Workspace**:
The boundary that owns all of a user's financial data; exactly one owner in v1.

**User**:
A person who signs in.
_Avoid_: Member, customer

### Institutions and accounts

**Institution**:
One provider login grouping financial accounts (e.g. Commbank, Vanguard, Wise); two logins at one provider are two institutions.
_Avoid_: Source, provider, connection

**Financial account**:
A single balance under an institution that holds exactly one commodity: a currency or an instrument.
_Avoid_: Subaccount, wallet, ledger account

**Unconfirmed account**:
A financial account created by an import for an unrecognised identifier, awaiting confirmation or merge.

**Merged account**:
An unconfirmed account the user has identified as an existing financial account; its statements count toward that account until it is unmerged.

**Manual account**:
A financial account with no statements (house, car, super, personal loan) whose value comes only from user-entered balances.
_Avoid_: Manual asset, manual liability

### Source files

**Source file**:
A retained uploaded file; one of statement, price import or receipt.
_Avoid_: Upload, document

**Statement**:
A source file containing account history or balances; may cover several financial accounts of one institution.

**Price import**:
A source file of dated unit prices or FX rates.

**Receipt**:
A source file attached to a canonical transaction as evidence for its itemisation.

**Source row**:
One parsed row of a source file; rows within one file are never merged with each other.

**Provider reference**:
An identifier a provider gives one activity, shared by all its rows (e.g. a conversion's rows in two currency balances and its fee row); rows sharing one form a single event.
_Avoid_: Group ID, batch

### Transactions

**Canonical transaction**:
One logical financial transaction, independent of how many source rows report it; its identity is stable across reimports.
_Avoid_: Entry; plain "transaction" when a database transaction is meant

**Transaction source**:
The link between a canonical transaction and one source row reporting it.

**Source-supported**:
Having at least one active source row.

**Soft deletion**:
Reversible exclusion of a retained record from active data.
_Avoid_: Delete, remove

**Manual suppression**:
A user's explicit soft deletion of a canonical transaction that persists across future imports.

### Events and legs

**Event**:
One economic activity grouping related canonical transactions, possibly across accounts.
_Avoid_: Job event, journal entry

**Leg**:
One signed movement of a single financial account within an event, with a role.
_Avoid_: Posting, split

**Leg role**:
The purpose of a leg: principal, fee, tax, interest and so on.

**Internal event**:
An event moving value between the user's own financial accounts (transfer, conversion, trade, liability payment); only its fee, tax and interest legs leave net worth.

**Unmatched transfer**:
A transfer leg whose counterpart has not been imported yet.

**Link**:
A reconciliation decision joining transactions from different accounts into one event; made automatically for unambiguous transfers or by the user.
_Avoid_: Match (for the stored decision), pair

**Opening-balance event**:
An event establishing an account's starting balance or position.

**Itemisation**:
The division of one canonical transaction into line items that sum exactly to its amount.
_Avoid_: Split (reserved for stock splits)

**Line item**:
One part of an itemised transaction; it becomes its own leg.

**Reconciliation**:
Linking equivalent or related records with stated confidence and provenance.

**Reconciliation decision**:
A recorded user or automatic choice (link, unlink, itemisation, category, tag, merge, suppression); later choices supersede earlier ones rather than editing them.

### Categories

**Category**:
A node in the spending-behaviour tree under Income, Savings, Essentials or Lifestyle, assigned to income and outflow legs.
_Avoid_: Budget, bucket

**Tag**:
A free-form label on a leg (e.g. `Europe 2024`), independent of its category.
_Avoid_: Label, project

**Net cash flow**:
Income minus every outflow that left net worth in a period.

**Unallocated**:
Income in a period not consumed by outflows; always equals that period's net cash flow.

**Spending**:
Outflows categorised under Essentials or Lifestyle.

### Investments and valuation

**Instrument**:
A security such as an ETF or share, shared by every account that holds it.
_Avoid_: Asset, ticker (as a name for the security itself)

**Position movement**:
A change in quantity of an instrument: trade, transfer, reinvestment, stock split or similar.

**Position snapshot**:
A verified quantity held at a date, used as a baseline or checkpoint.

**Price observation**:
A dated unit price of an instrument in a currency, with a price type (daily, trade or manual).
_Avoid_: Quote

**Override current price**:
A display-only price or FX rate shown when observations are stale; never part of any total.

**Holding value**:
Units held at a date multiplied by the applicable unit price at that date.

**Stale**:
Based on a price or FX rate older than the previous business day's close.

**Valuation completeness**:
Whether all units, prices, balances and FX needed for a value are available and not stale.

**Reporting currency**:
The currency totals are shown in; AUD.

**FX rate**:
The price of one unit of a currency in the reporting currency, stored as a price of that currency's instrument.
_Avoid_: Exchange price, conversion factor

**Carried balance**:
An account balance used after the last date it was observed; stale once carried more than 35 days.

### Processing

**Job progress record**:
A durable, ordered status update for a background job.
_Avoid_: Job event
