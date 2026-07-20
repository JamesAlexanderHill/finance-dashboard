// Resolves the "effective" category breakdown for a leg or event, per the
// categorization rule: if line items exist they ARE the breakdown (the
// leg's own category is ignored); otherwise the leg's own category stands.
// Pure — no I/O — so both analytics and UI can share exactly one
// implementation of the roll-up rule.

export type CategoryShare = {
  categoryId: string | null
  amount: bigint
}

export type RollupLeg = {
  categoryId: string | null
  unitCount: bigint
  lineItems: { categoryId: string | null; unitCount: bigint }[]
}

export type RollupEvent = {
  legs: RollupLeg[]
}

/**
 * A leg's effective category breakdown. If the leg has line items, each
 * contributes its own share (by its own amount and category) and the leg's
 * own `categoryId` is ignored entirely — the line items are a more granular
 * replacement for the leg-level tag, not an addition to it. Otherwise the
 * leg's own category is the sole share, even when `null` (uncategorized).
 */
export function resolveLegCategoryShares(leg: RollupLeg): CategoryShare[] {
  if (leg.lineItems.length > 0) {
    return leg.lineItems.map((item) => ({ categoryId: item.categoryId, amount: item.unitCount }))
  }
  return [{ categoryId: leg.categoryId, amount: leg.unitCount }]
}

/**
 * An event's effective category breakdown, for display. Own-leg shares (via
 * `resolveLegCategoryShares`) are used whenever at least one is categorized.
 * Only when every own-leg share is uncategorized do supplied `children` (a
 * sub-event parent's linked children) get consulted, concatenating each
 * child's own breakdown — this is the parent-decomposes-into-sub-events
 * fallback. `children` should never be supplied when feeding analytics
 * aggregation (see category-spending.ts / sankey.ts): a sub-event's children
 * already contribute their own spend in their own period, so folding them
 * into the parent's breakdown there would double-count.
 */
export function resolveEventCategoryBreakdown(
  event: RollupEvent,
  children?: RollupEvent[],
): CategoryShare[] {
  const ownShares = event.legs.flatMap(resolveLegCategoryShares)
  const ownHasCategory = ownShares.some((s) => s.categoryId !== null)
  if (ownHasCategory || !children?.length) {
    return ownShares
  }
  return children.flatMap((child) => resolveEventCategoryBreakdown(child))
}
