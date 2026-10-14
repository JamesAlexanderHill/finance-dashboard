# ADR 0010 — One statement may cover many financial accounts

**Status:** Accepted  
**Date:** 2026-10-14

## Decision

A statement (source file) is not owned by a single financial account. Each parsed source row is routed to exactly one financial account within the statement's institution (ADR 0011). Exports such as Wise (multiple currency balances) or IBKR (multiple subaccounts/currencies) therefore produce rows across several accounts from one file.

## Context and rationale

Provider exports do not align one-to-one with the accounts users reason about. Routing at row level avoids splitting files or inventing umbrella accounts.

## Consequences and follow-up

- Soft-deleting a statement deactivates source rows across every account it touched.
- Unknown identifiers auto-create *unconfirmed* accounts (ADR 0011).

## Related specification

- [PRD](../PRD.md)
- [Feature specifications](../features/)
