# ADR 0007 — Keep dated unit-price and quantity series independently

**Status:** Accepted  
**Date:** 2026-10-13

## Decision

Import daily prices from CSV as dated price observations with provenance. Derive quantity series from position movements and reconciled snapshots. Position value = quantity × appropriate dated price.

## Context and rationale

Enables visual separation of unit-price appreciation and accumulation of units.

## Consequences and follow-up

Price conflicts, missing dates, stale rates and corporate actions require explicit states; advanced performance attribution remains out of scope.

## Related specification

- [PRD](../PRD.md)
- [Feature specifications](../features/)
