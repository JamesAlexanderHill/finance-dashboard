# ADR 0006 — Owned-leg events as a regenerable projection

**Status:** Accepted  
**Date:** 2026-10-14  
**Amended by:** [ADR 0014](0014-leg-assignments-and-line-items.md) (where categories and line items are stored)  
**Supersedes:** an earlier draft of this ADR proposing strict double-entry with income/expense/equity category accounts (rejected 2026-10-14).

## Decision

1. **Owned legs only.** Legs post only to the workspace's own financial accounts. There are no income, expense or equity ledger accounts. Each leg carries the commodity of its account (see ADR 0011).
2. **Leg roles.** Each leg has a role such as `principal`, `fee`, `tax` or `interest`.
3. **Income and expense events.** An income event is typically one positive leg (`+1000 AUD` into a bank account); an expense event is typically one negative leg (`−30 AUD`). A transaction may be itemised into several line-item legs (e.g. from a receipt: `−10 AUD`, `−5 AUD`) whose amounts sum exactly to the transaction amount; an itemisation that does not sum exactly is rejected.
4. **Categories live on legs.** Income/expense legs, including fee/tax/interest legs, carry a category from an arbitrary-depth tree with fixed top-level categories Income (income kind) and Savings, Essentials, Lifestyle (expense kind) (default *Uncategorised*; no automatic categorisation in v1, any leg can be recategorised). Categories are stored keyed on each leg's stable identity (transaction ID plus leg key), never on event or leg IDs; see [ADR 0014](0014-leg-assignments-and-line-items.md). Categories track spending behaviour, not where money sits. Net-worth effect is determined by event balance, never by category. Internal-event principal legs are never categorised and are hidden from the Sankey. Legs may also carry tags.
   - Refunds are negative expense in the original purchase's category (if linked) or a user-chosen one, never income.
   - Distributions are income events in currency; reinvestment (e.g. Vanguard DRP) is a separate buy event, synthesised by the parser even when the statement shows only units.
5. **Internal events.** Transfers, conversions, trades and liability payments move value between owned accounts and change income/expense only through their `fee`/`tax`/`interest` legs. Examples:
   - Wise conversion: `−10 AUD`, `−0.10 AUD fee`, `+6 USD`.
   - Vanguard ETF buy: `−100 AUD` (Vanguard cash), `+10 VAS`, plus any fee legs.
   - Commbank → Vanguard cash funding is a *separate* transfer event from the subsequent buy.
   - Same-currency matched transfers (Commbank → Wise AUD 500, Commbank → Amex bill payment) must net to zero across principal legs.
6. **Unmatched transfers.** A transfer half whose counterpart has not been imported is an event with status *unmatched transfer*; it is excluded from income and expense and surfaced on the dashboard until matched.
7. **Opening balances.** Opening balances and positions are an *opening balance* event type, sourced from a dated statement balance/position observation in preference to manual entry. They are excluded from income and expense.
8. **Pure projection with deterministic IDs.** `events` and `event_legs` derive entirely from active canonical transactions, reconciliation decisions and opening baselines, and may be dropped and rebuilt at any time. Event IDs derive from their sorted contributing transaction IDs plus the governing decision ID, if any.

## Context and rationale

A personal finance user reads accounts as "money arrived / money left", not as balanced journals. Owned legs with roles and leg-level categories capture that while still preventing transfers, conversions and investment purchases from inflating income or expense. For conversions and trades, value balance is defined by the event's own implied rate or price, so the enforceable invariant is classification, not arithmetic.

## Consequences and follow-up

- Decisions are append-only: a change supersedes the previous decision, undo is a new decision, and each transaction exposes its decision history.
- Stable identity lives on transactions; anything that must survive rebuilds references transactions or decisions.
- Line-item legs need deterministic identity: line items are stored on the transaction with their own IDs, and their legs are keyed `line:<line item id>` ([ADR 0014](0014-leg-assignments-and-line-items.md)).
- Cost basis is not computed in v1; trade legs with prices and fee legs retain everything needed to derive it later.

## Related specification

- [PRD](../PRD.md)
- [ADR 0011](0011-institutions-single-commodity-accounts.md)
- [Feature specifications](../features/)
