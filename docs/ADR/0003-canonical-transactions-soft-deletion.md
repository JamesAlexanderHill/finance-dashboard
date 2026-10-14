# ADR 0003 — Canonical transactions and retained source provenance

**Status:** Accepted  
**Date:** 2026-10-13

## Decision

Store canonical transactions independently of source statement rows. Model many-to-many transaction_sources. Statement soft delete deactivates sources; a transaction stays active while supported by any active source, unless explicitly suppressed. Reimports restore original IDs.

## Context and rationale

Preserves overlapping import integrity and reversibility without deleting evidence.

## Consequences and follow-up

Requires careful uniqueness, idempotency, reconciliation invalidation and separate manual-suppression semantics.

## Related specification

- [PRD](../PRD.md)
- [Feature specifications](../features/)
