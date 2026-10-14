# Personal Finance Application — Product Requirements Document

**Version:** 0.2  
**Status:** Draft for implementation planning  
**Date:** 2026-10-13  
**Runtime:** Bun  
**Primary reporting currency:** AUD

## 1. Product vision and scope

Build a workspace-based personal finance application that consolidates financial accounts, statements, transactions, investment holdings, historical unit prices, liabilities, and financial reporting. Uploaded PDF/CSV statements are parsed asynchronously and transformed into a canonical transaction record, then into a unified event-and-leg representation. Users can import historical investment unit prices from CSV and visualise changes in unit price, units owned, and position market value independently.

The product must prioritise reproducibility and provenance: imported inputs remain stored; soft deletion removes records from active calculations without physically destroying their history; reimports can restore logically identical transactions while preserving their identifiers.

### Goals

1. Consolidate financial activity across Commbank, Vanguard, Stripe, Amex, Wise, and Interactive Brokers (IBKR).
2. Import and reimport overlapping financial statements without double-counting.
3. Represent economic events consistently across financial accounts using events and legs.
4. Automatically derive investment units from transaction history and dated position snapshots.
5. Import daily asset unit prices from CSV and retain a historical price series.
6. Show a reliable financial snapshot: assets, liabilities, net worth, this month against last month.
7. Maintain a modular, documented Bun monorepo with feature contracts and explicit inter-feature relationships.
8. Scope all financial data to workspaces, while supporting only a single owner/member per workspace in v1.

### Non-goals for the initial release

Direct bank feeds/Open Banking; automatic market data feeds; automatic FX feeds; trading or payment execution; multi-member workspaces/collaboration; tax advice; advanced performance attribution; automatic categorisation and budgets; cost basis and realised/unrealised gains; automatic receipt extraction. Design may allow these later without committing to them now.

## 2. Users, workspaces, and access control

- Users authenticate with Better Auth via passkey, with email OTP (delivered through Mailgun) for registration and recovery. Google OAuth is deferred until other users can sign up; Better Auth keeps adding it cheap.
- Registration creates a default workspace. Every financial account, statement, import, transaction, event, instrument, price observation, position, and dashboard query is scoped to a workspace.
- Include `workspaces` and `workspace_members` with a single `owner` member in v1. Do not ship invitations, multiple members, shared access, or role-management interfaces.
- On every server function, server route, object access, and background job, enforce workspace ownership; client-selected workspace identifiers are never sufficient for authorisation.

## 3. Financial accounts

Users create **institutions** (Commbank, Vanguard, IBKR, Wise, Amex, Stripe; two logins at one provider are two institutions) and financial accounts under them, with account type, name, masked identifier, commodity, and classification (asset/liability). Supported initial account types: bank, credit card, investment, brokerage, payment processor, loan, other. **A financial account holds exactly one commodity** (a currency or an instrument): Wise has one account per currency balance; Vanguard a cash account plus one per ETF; IBKR one cash account per currency plus one per ticker; Stripe balance/clearing accounts are separate. Imports that reference an unknown account under a known institution auto-create it as *unconfirmed* for the user to confirm or merge (ADR 0011).

Accounts display statement history, canonical transactions, balance observations, linked events, and related holdings. Balance calculation can use dated observed balances or a verified opening balance plus movements; incomplete records must never masquerade as a known current balance.

## 4. File uploads and statement processing

### Supported sources

| Institution | Financial evidence to import |
|---|---|
| Commonwealth Bank | Bank/loan transactions and available balances |
| American Express | Card purchases, payments, refunds, fees, balances |
| Wise | Transfers, fees, currency conversions and balances |
| Stripe | Payments, fees, refunds, payouts and clearing activity |
| Vanguard | ETF trades, distributions, unit movements and positions |
| IBKR | Trades, dividends, fees, FX, balances and positions |

Supported file formats are **PDF and CSV**. Each institution has versioned provider-specific parsers and fixtures; real/redacted sample exports live in `fixtures/<institution>/`, and a parser is not built until its fixture exists. A provider is considered supported only for specifically tested statement formats; the product must report unsupported variants rather than guessing.

### Statement lifecycle

`uploaded → queued → parsing → normalising → staging → reconciling → posting-events → completed`, with `partial` and `failed` terminal states where applicable. A statement may cover several financial accounts (e.g. Wise currency balances, IBKR subaccounts); each source row routes to exactly one account (ADR 0010). Uploaded binaries are stored privately in RustFS via its S3-compatible API, deployed in Docker Compose. Database records store object keys, checksums, size, file type, origin, parser version, uploaded timestamp, and soft-deletion state.

### Deduplication, soft deletion, and reimport

- Statement files and source rows are retained; soft delete is logical, not physical.
- `transactions` are canonical records, with a many-to-many link to original statement rows through `transaction_sources`.
- A canonical transaction is active when it has at least one active supporting source **and** is not individually suppressed/soft-deleted.
- Soft-deleting a statement makes its source rows inactive. A transaction with another active statement source remains active; one without any active sources is soft-deleted and excluded from active reports.
- Reimporting a transaction that became inactive solely because its source statement was soft-deleted restores that **same transaction ID**. New transactions are created and duplicates linked to their new source.
- A transaction explicitly soft-deleted by a user remains suppressed on future imports until explicitly restored, so imports cannot override deliberate user actions.
- No normal user workflow physically deletes source files, statements, or transactions. Permanent account erasure, retention compliance and backup expiry must be handled separately as a future administrative/legal requirement.
- Source rows within one file are never merged with each other, even when identical.
- Only posted rows are imported; pending/authorised rows are ignored in v1.
- Matching is conservative: use stable provider IDs first, then account-specific references/fingerprints. Without a provider ID, the fingerprint is `(account, posted date, amount, normalised description, ordinal among identical rows in the file)`. If overlapping files contain different counts of identical rows, matching pairs by ordinal and creates new transactions for the surplus (e.g. 2 in A and 3 in B → 2 matched, 1 new). Other ambiguous matches go to review rather than automatic merging.

### Required scenario

Statement A: T1, T2, T3. Statement B: T2, T3, T4. Both active → 4 unique active transactions. Soft-delete A → T1 inactive, T2/T3/T4 active. Soft-delete B → all inactive. Upload C: T1, T2, T5 → T1/T2 restored with original IDs, T5 created. No duplicated event contributions.

## 5. PostgreSQL-backed asynchronous queue and SSE

- Use PostgreSQL `jobs` and `job_progress` tables as the queue and durable status log; do **not** introduce Redis or a separate broker in v1.
- Worker service is independently runnable within the Bun monorepo and consumes jobs using atomic claims and `FOR UPDATE SKIP LOCKED` or an equivalent safe PostgreSQL pattern.
- Jobs require status, type, payload, workspace ID, attempts, `run_after`, lease/lock owner, lease expiry, heartbeat, progress, errors and idempotency key. Support retry with bounded backoff, stale-lease recovery, and an inspectable failed/dead-letter state.
- Parse into staging first; commit canonical records and import effects atomically to prevent partially applied financial state. Serialise conflicting reconciliation work per financial account/workspace as required.
- Persist progress events with a monotonically increasing event ID; stream them to authorised clients over SSE. `Last-Event-ID`/cursor replay or job-state refetch must recover after disconnection. PostgreSQL `LISTEN/NOTIFY` may reduce latency but is not the durable source of truth.
- Importing a daily price CSV is also an asynchronous job, with its own validation and per-row outcomes.

## 6. Transactions, financial events, and legs

Transactions are normalized institution-sourced facts: workspace, account, source identity, dates, description, type, signed amount, currency, optional security, quantity, unit price, fees, timestamps and status. Amounts and quantities use exact `numeric`/decimal representations, never binary floating point.

An **event** is one economic activity, possibly spanning accounts; a **leg** describes one monetary, instrument, or accounting movement. Legs post only to owned financial accounts and carry a role (`principal`, `fee`, `tax`, `interest`, …); there are no income/expense/equity ledger accounts (ADR 0006). An income event is typically one positive leg and an expense event one negative leg; a transaction may be itemised into line-item legs (e.g. from an attached receipt) summing exactly to its amount. Every income/expense leg (including fee/tax/interest legs) carries a manually assigned category from an arbitrary-depth tree with fixed top-level categories Income (income kind) and Savings, Essentials, Lifestyle (expense kind) (default *Uncategorised*), so flows can be shown as a Sankey diagram. Legs may also carry tags (e.g. `Europe 2024`) for cross-cutting filtering. Refunds are negative expense, never income. Distributions are income events; reinvestment is a separate buy event. Internal events (transfers, conversions, trades, liability payments) change income/expense only through fee/tax/interest legs; e.g. a Wise conversion is `−10 AUD`, `−0.10 AUD fee`, `+6 USD`, and funding Vanguard cash from Commbank is a separate transfer event from the subsequent ETF buy. A transfer half with no imported counterpart is an *unmatched transfer*, excluded from income/expense and surfaced until matched. Events are a regenerable projection of active transactions plus reconciliation decisions, with deterministic IDs; user intent (links, itemisations, categories) is stored only as decisions keyed on transaction IDs. Opening balances/positions are an *opening balance* event type, preferring statement observations over manual entry. An event must preserve links to originating transactions and be reconstructible. Supported event types: income, expense, internal transfer, currency conversion, investment buy/sell, distribution, interest, fee, refund, adjustment, unknown.

- A Commbank → Wise AUD 500 transfer is one event with two owned-account legs, not income plus spending.
- An ETF purchase has a cash reduction plus an instrument acquisition (quantity and cost), not an ordinary consumption expense.
- Stripe: a customer payment is an income event (+gross into the Stripe balance account, −fee leg); a payout is an internal transfer to the bank. Revenue counts once, at gross.
- Matching considers provider references, amount, date windows, account direction and currency. A transfer is matched automatically when two owned accounts show opposite-signed, exactly equal amounts in the same commodity within ±5 calendar days and each side has exactly one candidate; ambiguous matches remain reviewable; manual link/unlink choices survive reprocessing.
- A source's soft-deletion/restoration invalidates related event projections, without physically deleting provenance or decisions.
- Event pages offer unified timeline, account/date/type filtering, leg expansion, and review actions.

## 7. Investment holdings and unit-price history

### Holdings/quantity series

Track instrument identity (ticker, ISIN where available, exchange, denomination/currency), position movements (buy/sell, reinvestment, transfers, splits, other actions), and dated opening/position snapshots. Quantity at date `t` derives from a verified opening position plus signed quantity movements up to `t`, with snapshots used as reconciliation points, not blindly added to trades. Position handling for complex corporate actions is extensible; unsupported actions must be flagged for review.

### Daily unit-price CSV imports

Users upload a CSV containing one or more daily instrument/unit-price series. Supported workflow:

1. Choose an instrument (or map an instrument-identification column for multiple instruments).
2. Map CSV columns to `date`, `unit_price`, and optional `instrument`, `currency`, `price_type/source`.
3. Preview/validate rows; report invalid dates, unsupported currency, missing instrument and bad/negative numeric values.
4. Import dated observations asynchronously, with source row provenance and parser/mapping version.
5. Overlapping uploads with identical observations are deduplicated; conflicting prices for the same instrument, date, currency and price-type are not silently overwritten, but resolved through review or explicit selection.
6. Soft-deleting a price-import file deactivates its unsupported observations; surviving observations from other active source files remain. Existing source files/rows are preserved.
7. Trade rows in statements (e.g. Vanguard/IBKR buys) also record their execution unit price as a price observation of type `trade`, with the statement row as provenance.
8. Allow manually entered single-date prices, retaining the historical series and distinguishing manual inputs from CSV imports.

Daily prices and trade quantities are **separate time series**. For a valuation date `t`: `position_value(t) = units_held(t) × applicable_unit_price(t)`. Valuation uses the daily (CSV/manual) price; a `trade` price is used only when no daily price exists within the staleness window, and the value is then marked *trade-priced*. Do not silently forward-fill absent prices indefinitely; a price or FX rate older than the previous business day's close marks the value *stale* (public holidays ignored for now). The user may enter a cosmetic *override current price* (also for FX rates), persisted per instrument/currency pair, badged as an override, and cleared automatically when a newer real observation arrives; it is display-only and never alters stored observations or derived totals. Persist observed effective dates, import timestamps, original currency, and provenance.

### Historical charts

For each instrument/holding, display on a selectable timeline:

- **Unit price** (price appreciation/depreciation, independent of contributions).
- **Units owned** (changes due to purchases, sales, transfers, reinvestments, splits).
- **Total holding market value** (price × units, in native and, if FX available, AUD).
- Optionally annotate buy/sell events on charts.

Do not label an increase in holding value caused by adding units as an investment return. True performance metrics (e.g. time-weighted returns, realised/unrealised profit) require separately specified cash-flow, fees, distributions and corporate-action treatment and are outside the initial scope.

### Investment data decisions left flexible

The mechanism for obtaining initial holdings, market prices, and FX rates beyond the above CSV workflow is **TBD**. Store dated observations now so future manual entry, other CSV imports or external price services can share the same canonical history. Avoid embedding "manual only" as a schema constraint.

## 8. Assets, FX, and the financial dashboard

The Assets area consolidates investment holdings, observed cash accounts, liabilities, and manual accounts (house, car, super, personal loans: ordinary financial accounts under a *Manual* institution, valued by user-entered balance observations) without duplicate counting. Each amount has original currency, effective date, source and a known/unavailable/stale status. FX history must be stored as dated rates, imported through the price-import CSV pipeline with a currency pair treated as a priced instrument (conversion events in Wise/IBKR statements may also supply observed rates); no assumed 1:1 conversions or fake AUD totals.

The dashboard provides net worth, assets, liabilities, cash balances, investment values, recent events, monthly income, monthly expense and net cash flow, for a selected period compared against the previous N periods. Income = income-kind legs; Spending = Essentials + Lifestyle legs; Saved = Savings legs; net cash flow = Income − every unbalanced outflow (Savings fees included), which always equals the Sankey's *Unallocated* node. Internal events are hidden from the Sankey. One global control sets granularity (week/month/quarter/year/custom; default month) and N (default 6). Views: net-worth timeline (assets, liabilities, net worth; stale/partial points marked); cash flow (Sankey for the selected period plus a per-period split bar of income vs outflows with a net line); expenses (per-period stacked bar by top-level category with drill-down). A tag filter applies to all cash-flow and expense views. Net worth = total assets − total liabilities. Internal transfers, loan principal transfers and purchases of investments should not be misrepresented as income/consumption. The dashboard must show which totals are partial, stale or impossible to calculate due to missing account balances, prices or FX data.

Historical chart values are as-of-date calculations. Never apply today's price to a historical date without explicitly labelling it as an estimate; missing observations produce gaps or a disclosed staleness state. The dashboard should allow tracing each value back to its source observations, transactions or manual inputs.

### Suggested persistence model

| Domain | Primary tables (indicative) | Invariant |
|---|---|---|
| Identity / ownership | `workspaces`, `workspace_members` | One owner membership per default workspace for MVP; ownership checked server-side |
| Financial accounts | `institutions`, `financial_accounts`, `balance_observations` | One commodity per account; balances have effective dates and sources |
| Sources | `source_files`, `source_records`, `statements` | PDF/CSV binaries and parsed rows retained after logical deletion |
| Import execution | `jobs`, `job_progress`, `import_results` | Job leases, idempotency, durable progress and user-visible outcomes |
| Canonical activity | `transactions`, `transaction_sources` | Many statement-row occurrences can support one logical transaction |
| Economic activity | `events`, `event_legs`, `event_transaction_links`, `reconciliation_decisions` | Traceable and regenerable; manual matches not overwritten |
| Investments | `instruments`, `instrument_aliases`, `position_movements`, `position_snapshots` | Dated holdings derived from verified baselines plus unique movements |
| Asset prices | `price_observations`, `price_sources` | Dated price per instrument/currency/price convention; overlapping sources retained |
| FX | `fx_rate_observations` | Dated FX inputs with source and explicit incompleteness |

The data layer must distinguish **source-file lifecycle state**, **source support**, and **explicit user suppression**. Do not collapse them into one `deletedAt` field. `source_files` may contain either institution statements or investment price CSVs; their parsing pipelines differ, but use common provenance and retention rules.

## 9. Engineering architecture and repository conventions

### Required stack

- **Bun** runtime and native Bun workspaces/monorepo.
- **TanStack Start** web app, React, TanStack Query, Tailwind CSS.
- **PostgreSQL** database and durable jobs table.
- **Drizzle ORM** for schemas, migrations and typed database access.
- **Better Auth** (passkeys, email OTP via Mailgun; Google login deferred).
- **RustFS** private S3-compatible object store; local deployment in Docker Compose.
- **SSE** for import/job progress.

### Proposed root layout

```text
/
├── apps/
│   ├── web/                 # TanStack Start frontend + authenticated server routes
│   └── worker/              # Async parsing/reconciliation worker (Bun)
├── packages/
│   ├── db/                  # Drizzle schema, migrations, transactions
│   ├── domain/              # Canonical types, financial rules
│   ├── contracts/           # Shared validators and API/event schemas
│   ├── parsers/             # Provider-specific statement parsers
│   ├── imports/             # Import job contracts and common utilities
│   ├── ledger/              # Events, legs, reconciliation logic
│   └── shared/              # General-purpose utilities
├── infra/
│   └── compose.yaml         # Postgres + RustFS + app + worker
├── docs/
│   ├── PRD.md
│   ├── glossary.md
│   ├── ADR/
│   │   └── NNNN-*.md
│   └── features/
│       └── NN-*.md
├── package.json
├── bun.lock
└── README.md
```

Each package has explicit imports and dependency declarations (`workspace:*`), no duplicated copies of domain types, and no client-to-server-only imports. Domain rules and parsers do not depend on React; infrastructure adapters do not define domain semantics. The web app handles authenticated request/session concerns; the worker cannot infer a user's access rights from untrusted job payloads.

### Deployment

Docker Compose services: `web`, `worker`, `postgres`, `rustfs`. PostgreSQL and RustFS use persistent volumes with backups. RustFS object credentials are not public; the object service should not be exposed to unauthorised browsers. A production single-node RustFS configuration needs explicit backup/redundancy planning; a persistent Docker volume is not itself a backup.

## 10. Documentation contract — mandatory

The repository root must contain `docs/PRD.md`, `docs/ADR/*.md`, `docs/features/*.md` and `docs/glossary.md`.

Every feature specification must include: purpose/scope; user stories; functional behaviour; owned data/contracts; edge cases; acceptance criteria; testing notes; dependencies; **an interaction table explicitly listing every other registered feature, including `None` where no direct relationship exists**. Interaction entries must describe direction, effect and relevant contract/events.

**When adding, removing, renaming, or materially altering a feature:** update `docs/PRD.md` if scope changes; author or amend its feature document; update the **interaction tables in every pre-existing feature document** (including those recording `None`); add/update ADRs if making or reversing an architectural decision; update glossary; ensure a documentation validation check fails CI if the feature registry and interaction tables are incomplete. Review linked feature acceptance criteria for behavioural consequences. Documentation is a merge requirement, not a later clean-up task.

## 11. Core acceptance tests

1. A default workspace is created on first registration; all finance data is scoped to it and inaccessible from another workspace/user.
2. Statement A has T1/T2/T3, B has T2/T3/T4; exactly four logical transactions and no duplicate event contributions appear.
3. Soft-deleting A only deactivates T1. Soft-deleting B deactivates the remaining source-supported transactions. Reimporting T1/T2 restores their original identities.
4. Explicitly soft-deleting a transaction remains effective even if a later statement includes the record, until the user explicitly restores it.
5. Restarting the web app or worker does not lose queued work or create duplicate imports.
6. Users can reconnect to SSE and recover accurate persisted job state.
7. Uncertain transaction matches are not silently combined.
8. An AUD 500 Commbank-to-Wise internal transfer produces one event and does not change income/expense totals.
9. Vanguard/IBKR trades affect holdings once, including after overlapping import, source soft deletion, and restoration.
10. Upload a CSV of historical daily ETF prices; exact duplicate observations do not duplicate records, conflicts are surfaced, and a chart shows independent price, units, and holding-value lines.
11. A 10→12 unit increase at an unchanged $100 price changes position value $1,000→$1,200 but displays no unit-price appreciation.
12. A historical price gap or missing FX rate is surfaced as missing/stale, not fabricated.
13. Dashboard totals are derived from eligible asset/liability values and complete event records, with source traceability.
14. A CI documentation check requires every feature document to explicitly reference all registered features.

## 12. Delivery plan

Build order is vertical slices, each usable on its own:

1. Auth → Commbank CSV → canonical transactions (reimport/soft delete) → events → categories and Sankey.
2. Wise: conversions, multi-account statements, transfer matching.
3. Vanguard and IBKR: instruments, prices, holdings.
4. Valuation, FX and dashboard.

Capability groups (all within MVP):

**P0 / Foundation:** Bun workspaces; Docker Compose with PostgreSQL/RustFS; Better Auth; workspace model; shared contracts; core documentation conventions.

**P0 / Import and provenance:** Financial accounts; PDF/CSV statement parsing; PostgreSQL jobs; SSE; statement and transaction soft deletion; deduplication/reimport; source provenance.

**P0 / Economic model:** Canonical events/legs; cross-account transfer matching; manual reconciliation; consolidated timeline.

**P0 / Investments:** Instruments and dated holdings movements; daily unit-price CSV import; historical value charts; incomplete/stale pricing states.

**P0 / Financial snapshot:** Assets/liabilities, observed account balances, reporting-currency conversion infrastructure, dashboard, monthly comparisons.

**Post-MVP:** Live financial feeds, automated quote/FX retrieval, collaboration, budgeting, advanced portfolio performance, category analytics.

## 13. Remaining decisions (not assumed resolved)

Deliberately deferred:

- Provider export coverage and price conventions (NAV, traded close, adjusted/unadjusted): decided per institution when its `fixtures/<institution>/` samples are added.
- Corporate actions beyond buys/sells and distributions: flagged for review, not modelled.
- Source-file retention on full account erasure, and backups: post-MVP; nothing is physically deleted until then.

Resolved: reconciliation decisions are append-only; a change supersedes the previous decision, undo is a new decision, and each transaction shows its decision history.

## 14. Definition of done

A user can authenticate, operate inside a default workspace, create accounts, import supported PDF/CSV statements, track durable processing via SSE, deduplicate and restore soft-deleted financial records, view consolidated events/legs, derive investment unit counts, import historical daily ETF prices, view unit-price/quantity/market-value histories, and see a financially sound AUD dashboard with explicit missing-data states. The Bun monorepo includes validated, complete cross-feature documentation and recorded ADRs.
