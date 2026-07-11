# Sub-Events

A **sub-event link** decomposes one "lump sum" parent event — typically a
credit card repayment — into the many child events that actually make up
that amount: the individual, already-categorized purchases from the prior
statement cycle. Unlike a [relation](./6-relations.md), which pairs two
independent top-level events (a transfer's outflow and inflow), a sub-event
link is a strict one-parent-to-many-children decomposition: the parent is the
aggregate event, the children are its itemized detail, and there is no sign
relationship between them.

## Data Model

```
sub_event_links
  childEventId  — references events.id, PRIMARY KEY
  parentEventId — references events.id
  createdAt
```

- The primary key is on `childEventId` alone — a sub-event belongs to
  **exactly one** parent. This is the opposite cardinality of `eventRelations`,
  whose composite PK lets a child appear in many relation pairs.
- There is no `relationType` (a single concept) and no `workspaceId` column —
  scoped through its events, exactly like `eventRelations`.
- **v1 limits nesting to two levels**: a parent cannot itself already be a
  sub-event of something else, and a proposed child cannot already have its
  own sub-events. This is enforced in `subEventService.link`, not the schema.

## Creating & Removing Links

From the event drawer's **Sub-events** section (below Relations):

- **Existing sub-events** are listed with description, account, date, and
  amount; clicking one opens it in the drawer, showing a "Part of: …"
  breadcrumb back to its parent.
- **"Link sub-events"** opens a multi-select picker — unlike the Relations
  picker's click-one-to-link, this checks/unchecks a whole group and links
  them together in one call, since the common case is approving a whole prior
  statement's purchases at once.
- The picker is only offered on events that aren't already a sub-event
  themselves (the depth-2 limit).

### Suggested groupings

With an empty search box, the picker suggests the likely prior-statement
purchases:

1. **Account pairing** — if the event already has a `transfer` relation (the
   expected case — the repayment's checking-side outflow is normally already
   transfer-linked to the card account's payment-received credit), that
   relation's counterpart account is used directly. Otherwise, the most
   frequent historical transfer counterpart for this event's own account is
   used as a fallback.
2. **Statement window** — a ~35-day window ending a couple of days before the
   parent event's date (`STATEMENT_PERIOD_DAYS` / `STATEMENT_LOOKBACK_DAYS` in
   `sub-event-suggestions.ts`).
3. **Candidates** — net-outflow events (purchases, not the card's own credits
   or refunds — a v1 limitation) on the paired account within that window,
   excluding events already linked as someone else's sub-event.

The whole windowed set is suggested pre-checked, not just a ranked top few —
statement totals rarely reconcile exactly (fees, interest, carried balance),
so nothing is auto-pruned to "the subset that sums right." A `candidateSum`
is shown next to the parent's own magnitude as a sanity check; the user
deselects anything that doesn't belong before linking.

## At Import

Because a repayment always lags the purchases it covers by a statement cycle,
suggestions are also surfaced right after committing an import: for each
just-imported event that looks like a repayment (a net outflow with exactly
one unambiguous transfer match), the import wizard's final step proposes
linking that transfer plus the suggested sub-event grouping. Nothing is
linked automatically — the user reviews and approves (or skips) each group,
the same suggest-then-approve pattern used everywhere else in the app.

## Repayment Imports

The flow above only works once *both* sides of the repayment are already in
the database — it can't suggest sub-events for a statement you haven't
imported yet. **Repayment imports** invert the direction: instead of
importing a file first and hoping the app finds the repayment afterward, you
start from the repayment and pull in its statement directly.

From any event's drawer, the **Sub-events** section offers **"Import
statement"** (next to "Link sub-events") whenever the event isn't itself
already a sub-event:

1. **Choose the credit account** the statement belongs to — a card or line of
   credit, from the accounts flagged **Credit account** in their settings
   (see [Transactions → Accounts](./2-transactions.md#accounts)). The
   repayment's own account is excluded from the list.
2. **Import the file** — the same parser-select → file → instrument review →
   event review → commit steps as the regular [Import Wizard](./7-imports.md),
   reusing its components verbatim. The import is recorded in the `files`
   table exactly like any other import (`importedCount`/`skippedCount`/etc.,
   visible in [Import History](./7-imports.md#import-history)) — this is a
   different *entry point*, not a different kind of import.
3. **On commit**, every newly imported event is automatically routed to
   exactly one of two places, with no separate approval step (choosing this
   specific parent + account combination *is* the confirmation):
   - The one event that looks like the repayment's own transfer counterpart
     (opposite-signed, same magnitude, within a few days — the identical rule
     `suggestRelations('transfer', …)` already uses) is linked as an
     `eventRelations` **transfer** against the repayment, so it nets out of
     spend/income analytics instead of appearing as a purchase.
   - Every other imported event is linked as a **sub-event** of the
     repayment.
4. A result screen reports the counters, which event (if any) was linked as
   the transfer, and how many were linked as sub-events — if no transfer
   match was found, it says so and the pairing can still be made by hand from
   the drawer.

Implementation: `repaymentImportService.commit`
(`src/db/services/service/repayment-import.ts`) wraps the ordinary
`importService.commitImport`, then re-decorates the committed events to run
the same `suggestRelations`/`assignTransferParentChild` logic the drawer's
relation picker uses. UI: `RepaymentImportWizard`
(`src/components/event/repayment-import-wizard.tsx`), which reuses
`ImportWizard`'s `Step1`/`InstrumentReview`/`Step3`/`Step4` components with
its own account-selection step prepended.

## Display Logic

Until linked, every event displays as an independent row, exactly as before —
this feature has no effect until a link exists. Once a parent has sub-events:

- The `/events` and per-account events tables show a chevron with the child
  count; expanding it reveals the linked children as indented rows beneath
  the parent, without affecting pagination (page size still counts only
  top-level events).
- The event drawer's header mini-bar (`EventLegBar`) shows the parent's
  rolled-up category breakdown — see below — instead of its own (often
  uncategorized or transfer-excluded) legs.

## Categorization Roll-Up

Categories are resolved through one shared chain, from the most granular
level available down to "uncategorized" only when nothing more specific
exists:

1. **Line item → leg** — if a leg has line items, their categories are its
   effective breakdown and its own `categoryId` is ignored.
2. **Leg → event** — an event's own categorized legs (after step 1) are used
   whenever at least one exists.
3. **Sub-event → parent** — only when every one of an event's own legs is
   uncategorized does it fall back to concatenating its linked children's own
   breakdowns (recursively, though v1 only ever nests one level deep).

This is implemented once, in `resolveLegCategoryShares` /
`resolveEventCategoryBreakdown` (`src/db/services/service/category-rollup.ts`),
and shared by the UI and (steps 1–2 only, see below) analytics.

## Limitations

- **Sub-event roll-up (step 3 above) is UI-only — it does not feed the
  category bar chart or Sankey diagram.** A sub-event's children are already
  first-class categorized events contributing their own spend in their own
  (prior-statement) period. If the parent is also `transfer`-linked — the
  expected case — [relation netting](./6-relations.md) already excludes its
  own legs from analytics entirely, so there is nothing left to "fill in" from
  the children; folding them into the parent's period as well would double
  count that spend. Line-item roll-up (steps 1–2) has no such risk and does
  feed analytics, since line items are children of the same leg, not separate
  events.
- Suggested groupings are heuristics (account-pairing plus a date window).
  They can miss purchases just outside the window or on an unexpected
  account, and can surface unrelated candidates — always review before
  approving.
- Only net-outflow candidates are suggested; a card's own credits or refunds
  within the statement window are not proposed as sub-events.
- Repayment imports use `suggestRelations` with `limit = 1` internally — if
  a statement contains more than one plausible transfer counterpart (e.g. two
  same-amount credits within the window), only the first is picked and the
  rest become sub-events by default; check the result screen and re-link by
  hand if that's wrong for a given statement.
