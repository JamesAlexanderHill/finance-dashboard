# Transaction Relations

A **relation** links two events so the dashboard reflects what actually happened
to your money rather than treating every transaction in isolation. Moving money
between your own accounts should not look like spending or income, and being paid
back for a shared expense should reduce that expense — relations make both true.

Relations are stored in the `eventRelations` table and are created and removed
from the [event drawer](./2-transactions.md#event-drawer). They are scoped to a
workspace through their events.

## Relation Types

| Type | Meaning | Example |
|------|---------|---------|
| `transfer` | An internal movement of money between two of **your own** accounts. Net worth is unchanged. | Paying off your AMEX bill from CommBank; moving AUD from CommBank to Wise. |
| `reimbursement` | Someone pays you back for an expense you covered. The inflow offsets the original expense. | You pay $300 for a group dinner; friends send you $200 back. |
| `refund` | A merchant reverses a purchase. Behaves like a reimbursement — an inflow that offsets an earlier expense. | Returning a $80 item for a full refund. |

`reimbursement` and `refund` are distinct labels but behave identically in
analytics; the difference is only who sent the money back (a person vs. the
merchant).

## Directionality

Every relation has a **parent** and a **child**. The convention is the same for
all three types:

> **parent = the original / anchor outflow** · **child = the offsetting or
> destination event (the inflow)**

| Type | parent | child |
|------|--------|-------|
| `transfer` | the source account's outflow (−) | the destination account's inflow (+) |
| `reimbursement` | the expense you paid (−) | the repayment you received (+) |
| `refund` | the original purchase (−) | the merchant refund (+) |

When you link two events in the drawer the parent and child are assigned
automatically from the sign of each event's net amount: the outflow becomes the
parent and the inflow becomes the child. For same-sign or ambiguous pairs the
event you have open is kept as the parent.

## Data Model

```
event_relations
  parentEventId — references events.id   ┐ composite primary key
  childEventId  — references events.id    ┘ (a pair can be linked once)
  relationType  — 'transfer' | 'reimbursement' | 'refund'  (event_relation_type enum)
```

- `relationType` is a Postgres enum (`eventRelationTypeEnum` in `src/db/schema.ts`).
- The `(parentEventId, childEventId)` pair is unique. Re-linking the same pair
  updates its type rather than inserting a duplicate.
- There is **no `workspaceId` column** — relations are scoped through their
  events, which always belong to the same workspace. The service validates that
  both events belong to the caller's workspace before creating or removing a
  relation.
- Drizzle relations expose both directions on an event as `parentRelations`
  (this event is the parent) and `childRelations` (this event is the child).

## Creating & Removing Relations

Open any event to reveal a **Relations** section in the drawer, below Legs:

- **Existing relations** are listed with a direction-aware label ("Transfer to",
  "Transfer from", "Reimbursed by", "Reimbursement for", "Refunded by", "Refund
  of"), the linked event's description, account, date, and amount. Clicking a
  relation opens that linked event in the drawer.
- **"Link transaction"** opens a picker: choose the relation type, then search by
  description or amount for the other event. The current event and any already
  linked events are excluded from results. Selecting a result creates the
  relation.
- The **✕** button on a relation removes it.

Creating or removing a relation refreshes the drawer and invalidates the route
loaders that feed the dashboard and category charts, so analytics update
immediately.

## Effect on Analytics

Relations change how the **category bar chart** and **Sankey diagram** aggregate
legs (see [Categories → Spending Analysis](./4-categories.md#spending-analysis)).
The transformation is applied by `applyRelationsToLegs`
(`src/db/services/service/relation-netting.ts`), a pure function shared by both
services:

- **Internal transfers are excluded.** Any leg belonging to an event in a
  `transfer` relation (as parent or child) is dropped from spend/income
  aggregation. Balances and net worth are unaffected — the money really did move.
- **Reimbursements and refunds are netted.** The child event's inflow is
  re-attributed to the parent expense's category, so it offsets rather than
  appears as income. A $300 dinner (`−30000` in "Dining") with a $200 repayment
  nets to `−10000` in "Dining".
  - The offset lands in the **parent expense's period**, not the period the
    repayment was received, so a charge and its later repayment net within the
    same bucket.
  - If the parent has multiple categorised legs, the offset uses the **first
    categorised leg's** category.
  - If the parent expense has no categorised leg in the selected range (e.g. it
    is older than the chart window), the child inflow is simply omitted — there
    is nothing to net it against.
- **Soft-deleted events** are already excluded from analytics, so a relation to a
  deleted event has no effect.
- If an event is in both a `transfer` and a `reimbursement`/`refund` relation,
  the transfer exclusion wins.

## Workspace Scoping

Relations only ever connect events within a single workspace. Listing, creating,
and removing relations all go through `relationService`
(`src/db/services/service/relation.ts`), which enforces that both events belong
to the caller's workspace.

## Limitations

- Relations are created manually. Automatic detection of likely transfer pairs is
  not implemented.
- Netting attributes a multi-leg parent's reimbursement to a single category (the
  first categorised leg), not proportionally across its legs.
