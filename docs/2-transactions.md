# Transactions

This document covers the full lifecycle of financial data in the app: how transactions are modeled (events and legs), how accounts and instruments are managed, and how data is imported from bank and broker exports.

## Events

An **event** is a single financial transaction. Every event belongs to one account and has one or more **legs** (see below). Events are never physically deleted — they are soft-deleted by setting `deletedAt`, preserving history and allowing re-import to restore them.

### Event Types

| Type | Description |
|------|-------------|
| `purchase` | Consumer spending (retail, restaurants, online) |
| `transfer` | Movement of funds between accounts |
| `exchange` | Currency conversion within a multi-currency account |
| `trade` | Investment transaction — buying or selling securities |
| `bill_payment` | Recurring or one-time bill (utilities, subscriptions, rent) |
| `payout` | Income — salary, bonus, dividend, distribution |

### Dates

Each event tracks two dates:

- **`effectiveAt`** — When the transaction actually occurred (the consumer-facing date).
- **`postedAt`** — When the transaction posted to the account (the financial settlement date). Usually the same as `effectiveAt` but can differ (e.g. a cheque clears two days after it is written).

Balance calculations use `effectiveAt`.

### Legs

A **leg** is one side of a transaction — a signed flow of a specific instrument. Most transactions have a single leg, but multi-leg events are supported:

| Scenario | Legs |
|----------|------|
| Salary deposit | 1 leg: +AUD |
| Currency exchange | 2 legs: −AUD, +USD |
| Share purchase | 2 legs: −AUD cash, +ETF units |
| Supermarket split | 3+ legs: one per spending category |

Each leg records:
- `instrumentId` — Which currency or asset moved
- `unitCount` — Signed amount in minor units (e.g. cents for AUD; whole numbers for shares). Negative = outflow, positive = inflow.
- `categoryId` — Optional category tag (see [Categories](./categories.md))
- `description` — Optional per-leg note

Legs can also be subdivided into **line items** for itemized splits within a single leg (e.g. a $127.50 supermarket leg split into $48.50 groceries + $52.00 produce + $27.00 dairy).

### Deduplication

Each event has a unique `dedupeKey` used to prevent duplicate imports:

- If the source provides a transaction ID: `dedupeKey = "{accountId}:{externalEventId}"`
- Otherwise: `dedupeKey = SHA256("{accountId}|{effectiveAt}|{amountMinorUnits}|{normalizedDescription}")`

During import, if a matching `dedupeKey` already exists the event is either skipped or restored (if it was previously soft-deleted and the user chose to restore).

### Relations

Events can be linked to one another as **internal transfers**, **reimbursements**, or **refunds**. Relations are managed from the event drawer and make the spending analytics aware of what really happened: transfers between your own accounts are excluded from spend/income, and reimbursements/refunds offset the expense they relate to. See [Relations](./6-relations.md) for the full model.

### Event Drawer

Clicking any event row anywhere in the app opens the **event drawer** — a slide-in panel on the right side of the screen, controlled by the `viewEvent` search parameter on the current route. The drawer shows:

- **Details** — effective and posted dates, external ID (if any), and dedupe key.
- **Delete / Restore** — a toggle button that soft-deletes the event (sets `deletedAt`) or restores it (clears `deletedAt`). Deleted events display with a strikethrough title. Checkpoints and rates are recomputed immediately after the toggle.
- **Legs** — each leg is listed with its instrument ticker, signed amount, and a category selector. Changing the category updates `legs.categoryId` in place without affecting the event's other fields.
- **Line items** — each leg has an expandable line-item editor. Clicking "Items (N)" expands a panel where sub-splits can be added, edited, or removed. Each line item has an amount (in minor units), an optional category, and an optional description. The line-item total must equal the parent leg's `unitCount` before saving is allowed.
- **Relations** — linked transactions (transfers, reimbursements, refunds). Each relation shows the other event with a direction-aware label and can be opened or removed. The "Link transaction" picker suggests likely matches for the chosen relation type and lets you search for any other event. See [Relations](./6-relations.md).

### Events Pages

Events can be browsed from two places:

- **`/events`** — a global cross-account list of all events in the workspace, with an account filter dropdown that narrows results to a single account. Pagination is controlled via `page` and `pageSize` search params.
- **`/accounts/$accountId/events`** — the same paginated table scoped to one account, accessible via the account detail page or breadcrumb navigation.

Both views open the event drawer when a row is clicked.

---

## Accounts

An **account** represents a financial institution or wallet (e.g. CommBank, Amex, Wise, Vanguard). Each account belongs to a workspace and holds one or more instruments.

### Account Settings

- **Name** — User-assigned label (e.g. "CommBank Everyday").
- **Color/hue** — One of eight base colors (blue, emerald, amber, rose, violet, cyan, orange, fuchsia), used for chart coloring. If unset, a color is auto-assigned by position.
- **Default instrument** — The primary currency or asset for the account. Used as the display default in the UI.

### Chart Coloring

Each account's base hue is divided into five shades (0–4) which are assigned to that account's instruments. This ensures visual continuity between an account and all the assets it holds across charts.

### Deletion

An account can only be deleted if it has no events. Attempting to delete an account with existing transactions returns an error.

---

## Instruments

An **instrument** is a currency or asset held within an account (e.g. AUD in a CommBank account, VHY shares in a Vanguard account). Instruments are account-scoped — the same ticker can exist independently in multiple accounts.

### Key Fields

| Field | Description |
|-------|-------------|
| `ticker` | Symbol code, uppercase (e.g. `AUD`, `USD`, `VHY`) |
| `name` | Human-readable name (e.g. "Australian Dollar") |
| `exponent` | Decimal places for display. Currencies: typically `2` (cents). Shares: typically `0` (whole units). |

### Balance Tracking

An instrument's current balance is calculated as:

```
balance = latest checkpoint balance + sum of all legs since checkpoint period end
```

Monthly **checkpoints** (`instrumentCheckpoints` table) store snapshots of each instrument's balance, avoiding a full ledger scan on every query. Balance history is available at day, week, or month granularity.

### Exchange Rates

Each instrument can have an exchange rate record (`instrumentRates`) expressing how many units of the user's home currency one unit of this instrument is worth. Rates are used to convert multi-currency balances for display in the dashboard's net worth card and stacked area chart.

Rates have a `source` field:
- `'manual'` — explicitly set by the user via the instrument detail page.
- `'transaction'` — inferred automatically from a trade event that exchanged the instrument against the home currency (e.g. a Vanguard buy where AUD and ETF units are both legs of the same event).

The instrument detail page (`/accounts/$accountId/instruments/$instrumentId`) shows the current value (balance × rate converted to home currency) and an "Update price" button that opens an inline form. Entering a new rate and saving writes a `'manual'` rate record with the current date as `asOf`. The `source` and `asOf` values are displayed beneath the current value.

Instruments whose ticker matches the user's `homeCurrencyCode` are treated as the home currency and do not show exchange rate UI.

### Deletion

An instrument can only be deleted if it has no legs. Deletion also removes all checkpoints and rate records for that instrument.

---

## Imports

Imports turn a raw bank or broker file into events and legs through the **Import Wizard** (pick a parser → review instruments → review events → commit). PDF statements are parsed server-side and their originals are stored; canonical CSVs are parsed in the browser. [Deduplication](#deduplication) decides whether each incoming event is created, skipped, or restored.

See **[Imports](./7-imports.md)** for the full pipeline: the canonical format, the available parsers, object-storage of originals, import-run tracking, the single-file and bulk wizards, and import history.
