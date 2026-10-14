# ADR 0009 — Dated valuations and FX with explicit incompleteness

**Status:** Accepted (implementation rules in [ADR 0013](0013-valuation-rules.md))  
**Date:** 2026-10-13

## Decision

Represent observed asset prices, positions, account balances and FX rates as dated source-aware observations. Dashboard values in AUD require appropriate conversion; missing values produce incomplete outputs, and prices/FX older than the previous business day's close produce stale outputs. A persisted, badged, display-only override current price (instrument or FX) may be shown; it clears when a newer observation arrives and never enters totals. FX rates are imported through the same CSV price-import pipeline, treating a currency pair as a priced instrument; other input sources remain TBD.

## Context and rationale

Avoids false precision and allows historical charts without committing to upstream market feeds.

## Consequences and follow-up

Rate selection, gap handling and price precedence are defined in [ADR 0013](0013-valuation-rules.md); market close time zones are not modelled yet.

## Related specification

- [PRD](../PRD.md)
- [Feature specifications](../features/)
