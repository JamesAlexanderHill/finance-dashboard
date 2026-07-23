# Accounts

## Summary

The accounts feature owns financial accounts and the instruments (currencies/assets) held
within them, including balance calculation (via monthly checkpoints) and exchange-rate
tracking used to convert multi-currency balances to a user's home currency.

## Goals

- Represent a financial institution or wallet as an **account**, holding one or more
  **instruments**.
- Make an instrument's current balance and historical balance cheap to query via monthly
  checkpoints, without scanning the full ledger.
- Track exchange rates (manual or transaction-derived) so multi-currency holdings can be
  displayed in a user's home currency.

## Non-goals

- Recording transactions themselves — that's [transactions](02-transactions.md).
- Deciding _when_ to recompute checkpoints/rates after a transaction changes — callers
  (transactions, imports) invoke `checkpointService`/`rateService` explicitly after mutations.

## Domain terminology

See the [glossary](../glossary.md): **account**, **instrument**, **checkpoint**. An account's
**default instrument** is its primary currency/asset, used as the UI display default.

## Functional requirements

### Accounts

- Name, an optional base **color** (one of eight hues, cycled by position if unset — used for
  chart coloring), and an optional default instrument.
- Each account's hue is divided into five shades, assigned to its instruments, so an account
  and everything it holds are visually related across charts.
- An account can only be deleted if it has no events.

### Instruments

- `ticker` (e.g. `AUD`, `VHY`), `name`, `exponent` (decimal places — `2` for currencies,
  typically `0` for shares). Account-scoped: the same ticker can exist independently in
  multiple accounts.
- Current balance = latest monthly checkpoint balance + sum of non-deleted legs since that
  checkpoint's period end. Balance history is available at day/week/month granularity.
- Instruments matching the user's `homeCurrencyCode` are the home currency and show no
  exchange-rate UI.
- Exchange rates have a `source`: `manual` (set via the instrument detail page) or
  `transaction` (inferred from a 2-leg exchange/trade event against the home currency).
  Manual rates take priority when both exist.
- An instrument can only be deleted if it has no legs; deletion also removes its checkpoints
  and rate records.

## Responsibilities

- Account and instrument CRUD, scoped to the caller's workspace.
- Balance checkpoint computation and refresh (`checkpointService`).
- Exchange rate computation and refresh (`rateService`).

## Public contracts

`~/features/accounts`:

- `accountService` — `getById`, `list`, `create`, `update`.
- `instrumentService` — `getById`, `list`, `getBalances`, `getAccountBalances`, `getBalance`,
  `getBalanceHistory`, `create`, `update`, `delete`. Types: `AccountBalance`, `BalancePoint`,
  `BalanceHistoryRange`, `BalanceHistoryPeriod`.
- `checkpointService` — `refresh(ctx, instrumentId)`, `refreshAll(ctx)`.
- `rateService` — `refresh`, `refreshAll`, `setManualRate`, `getRate`, `getRates`. Type: `CurrentRate`.
- UI: `InstrumentCard`, `AccountColorSelect`.

## Dependencies

None — depends only on the core platform.

## Interactions with other features

- **Transactions**: the event drawer calls `checkpointService`/`rateService` to recompute
  balances after an event is edited, deleted, or restored.
- **Imports**: after committing a batch of events, calls `checkpointService.refresh` and
  `rateService.refresh` for every affected instrument.
- **Dashboard**: reads `instrumentService` for balance history and net-worth calculations.
- **Dev tools**: seeds and clears accounts/instruments/checkpoints/rates directly, and calls
  `checkpointService.refreshAll`/`rateService.refreshAll`.

## Authorization and permissions

All operations are scoped by `RequestContext.workspaceId` — a user can only read or modify
accounts/instruments in their current workspace.

## Data ownership

`accounts`, `instruments`, `instrument_checkpoints`, `instrument_rates`.

## Failure modes

- Updating/deleting an account or instrument that doesn't exist (or belongs to another
  workspace) throws `Account not found` / `Instrument not found`.
- Deleting an instrument with existing legs, or an account with existing events, throws rather
  than silently failing.

## Acceptance criteria

- Creating an event with a new instrument, then recomputing checkpoints, produces a correct
  current balance matching a manual ledger sum.
- Setting a manual exchange rate takes priority over a transaction-derived one for the same
  instrument.
- An account/instrument with dependent data cannot be deleted.

## Open questions

- None currently.

## Related architectural decisions

- [ADR 0004 — Feature-oriented architecture](../adr/0004-feature-oriented-architecture.md)
