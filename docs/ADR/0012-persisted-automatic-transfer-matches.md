# ADR 0012 — Automatic transfer matches are persisted decisions

**Status:** Accepted
**Date:** 2026-10-14

## Decision

1. **Matches are decisions, not projection logic.** When the transfer rule matches a pair (opposite-signed, exactly equal amounts in the same commodity, different owned accounts, within ±5 calendar days, exactly one candidate on each side), the match is stored as a `link` reconciliation decision with actor `system` on both transactions. The event projection groups transactions by their current link group; it never re-runs the rule itself.
2. **Matching runs before every rebuild.** Imports, statement soft delete/restore and every recorded decision run the matcher, then rebuild events, in the same DB transaction.
3. **References narrow candidates.** When a row states its counterpart's posting date (a BPAY receipt such as `CBA20250101…` names the day the payer's bank posted it), only a transaction posted on that date is a candidate. This resolves weekly transfers that land a few days later, where the date window alone finds two candidates; the match must still be unique on both sides.
4. **Users always win.** A transaction that has ever had a link decision (system or user) is never matched automatically again. Unlinking appends `groupId: null` decisions for the whole group, so the pair stays apart; manual links can join any transactions in different accounts, including unequal amounts.
5. **Provider references group without decisions.** Rows a provider reports under one reference (a Wise conversion's currency rows and its fee rows, a card payment split across currency balances) are grouped by that reference in the projection. This is a fact from the source, not a choice, so it needs no decision.
6. **Lone transfers stay visible.** A transaction hinted as a transfer by its parser (e.g. a Wise top-up, a home-loan repayment), marked as one by the user, or whose linked counterpart is no longer active is an *unmatched transfer*: internal, excluded from income and expense, and listed for review.

## Context and rationale

Running the rule inside the pure projection would let a later import silently undo an earlier match: a third candidate arriving makes a unique pair ambiguous, and the transfer turns back into income and spending. Persisting the match keeps reports stable and gives every match provenance (`actor = system`) and an undo path that uses the same append-only decisions as manual choices.

## Consequences and follow-up

- Events remain a deterministic projection of transactions plus decisions; system decisions are part of that input.
- The review queue shows ambiguous candidates (computed on the fly) and unmatched transfers with plausible counterparts.
- Soft-deleting one side of a matched transfer turns the other side into an unmatched transfer; restoring it re-forms the event from the stored decision.

## Related specification

- [PRD](../PRD.md)
- [ADR 0006](0006-event-leg-ledger.md)
- [Feature specifications](../features/)
