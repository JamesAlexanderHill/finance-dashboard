# ADR 0011 — Institutions group single-commodity financial accounts

**Status:** Accepted  
**Date:** 2026-10-14

## Decision

1. **Institution.** A workspace has institutions (e.g. Commbank, Vanguard, IBKR, Wise, Amex, Stripe). Two logins at the same provider are two institutions (e.g. "Commbank — joint"). `financial_accounts.institution_id` replaces free-text institution metadata.
2. **One commodity per account.** A financial account holds exactly one commodity: a currency or an instrument. Examples:
   - Commbank: one account per bank/loan account.
   - Wise: one account per currency balance.
   - Vanguard: a cash account plus one account per ETF.
   - IBKR: one cash account per currency plus one account per ticker.
3. **Shared instruments.** Holding accounts reference a shared instrument; the same instrument held at two institutions is two accounts referencing one instrument, and prices are stored once on the instrument. Holdings views aggregate per instrument with a per-account breakdown.
4. **Auto-created unconfirmed accounts.** When an import targeting a known institution contains rows for an unknown account identifier (a new ticker, new currency balance or new bank account), the account is created automatically and marked *unconfirmed* in the import results; the user confirms it or merges it into an existing account. An import whose institution cannot be determined fails.

## Context and rationale

Provider exports bundle several balances; users think in single balances. One commodity per account means a leg's commodity is always its account's commodity and balances never need a currency breakdown.

## Consequences and follow-up

- Statements route rows to accounts within one institution (ADR 0010).
- Merging an unconfirmed account into an existing one must be a reversible decision so reprocessing reproduces it.

## Related specification

- [PRD](../PRD.md)
- [ADR 0010](0010-statement-multi-account-routing.md)
- [Feature specifications](../features/)
