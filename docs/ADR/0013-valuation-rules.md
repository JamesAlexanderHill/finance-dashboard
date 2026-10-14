# ADR 0013 — Valuation rules: rate selection, staleness, gaps and completeness

**Status:** Accepted
**Date:** 2026-10-14
**Implements:** [ADR 0009](0009-currency-and-valuation-history.md)

## Decision

1. **FX rates are prices of a currency instrument.** Each foreign currency is an instrument on the `FX` exchange (symbol = the currency, priced in AUD), so FX rates share price observations, CSV import, conflict handling and overrides. Imports create one for every non-AUD currency held. Statements supply rates where they state them: IBKR's year-end forex marks are daily rates; each Wise or IBKR conversion's implied rate is a trade rate.
2. **Rate selection at date *t*** (prices and FX alike), never using a later observation:
   1. the latest fresh daily or manual price (manual wins on the same day);
   2. else the latest fresh trade price, marked *trade-priced*;
   3. else the latest observation of any type, marked *stale*.
   *Fresh* means no older than the previous business day before *t* (weekends skipped; public holidays ignored for now). Dates are calendar dates; no market-close time zone is modelled yet.
3. **Gaps are never filled.** With no observation on or before *t*, the value is unavailable: the account is left out and the total is *partial*. Currencies are never converted 1:1. Charts plot holding value only on dates with a price.
4. **Balances.** A statement account's balance at *t* is its earliest live opening balance plus movements up to *t*. It is known up to the account's latest statement closing date and carried forward after that; a manual account uses its latest value on or before *t*. A balance carried more than **35 days** (one monthly statement cycle plus slack) past its last statement or value is *stale*.
5. **Before tracking starts** an account is left out. The total is *partial* only if the account's first known balance was non-zero, since a zero opening balance usually means it was newly opened.
6. **Overrides** are a separate `price_overrides` table: display-only, badged, cleared when a live observation dated on or after the override arrives, and never read by any total.

## Context and rationale

Statements arrive monthly to yearly and prices or rates are imported irregularly, so a value needs a clear answer to "which observation applies, and how much should we trust it?". Treating FX as just another price keeps one pipeline and one set of rules. Marking values stale or partial, rather than estimating, keeps every figure traceable to an observation.

## Consequences and follow-up

- A net-worth "today" point is usually stale because statements lag; the dashboard says which balances and prices are old.
- The 35-day balance threshold is an assumption; revisit it if statements become more frequent (or less).
- Public holidays and exchange close times are not modelled; prices on a holiday-adjacent day may be marked stale.

## Related specification

- [PRD](../PRD.md)
- [ADR 0007](0007-historical-prices-and-holdings.md)
- [ADR 0009](0009-currency-and-valuation-history.md)
- [Feature specifications](../features/)
