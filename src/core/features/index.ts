/** Public contract of the feature-registration capability. */
export type { AppFeature, FeatureRegistrationContext, NavEntry, HealthCheck } from './types'
export { registerFeatures, createCollectingContext, FeatureDependencyError } from './registry'
