/**
 * Public contract of the relations feature. Other features and routes must
 * import from here — never from `./domain/*` or `./infrastructure/*` directly.
 */
export { relationService } from './domain/relation-service'
export { applyRelationsToLegs } from './domain/relation-netting'
export type { NettingLeg, NettingRelation } from './domain/relation-netting'
export { suggestRelations } from './domain/relation-suggestions'
export type { SuggestionEvent } from './domain/relation-suggestions'
export type { AnalyticsRelation, AnalyticsChildLeg } from './infrastructure/relation-query'

export { relationsFeature } from './feature'
