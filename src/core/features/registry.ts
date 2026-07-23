import type { AppFeature, FeatureRegistrationContext, HealthCheck, NavEntry } from './types'

export class FeatureDependencyError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FeatureDependencyError'
  }
}

/**
 * Validates that every feature's declared dependencies are present (and
 * catches duplicate ids / dependency cycles), then calls each feature's
 * `register()` in an order where dependencies always register first.
 * Throws `FeatureDependencyError` on any violation — an app should fail to
 * boot rather than run with a feature silently missing a dependency.
 */
export function registerFeatures(features: readonly AppFeature[], context: FeatureRegistrationContext): void {
  const byId = new Map<string, AppFeature>()
  for (const feature of features) {
    if (byId.has(feature.id)) {
      throw new FeatureDependencyError(`Duplicate feature id: "${feature.id}"`)
    }
    byId.set(feature.id, feature)
  }

  for (const feature of features) {
    for (const dep of feature.dependencies ?? []) {
      if (!byId.has(dep)) {
        throw new FeatureDependencyError(`Feature "${feature.id}" depends on unknown feature "${dep}"`)
      }
    }
  }

  const registered = new Set<string>()
  const visiting = new Set<string>()

  function visit(feature: AppFeature) {
    if (registered.has(feature.id)) return
    if (visiting.has(feature.id)) {
      throw new FeatureDependencyError(`Circular feature dependency involving "${feature.id}"`)
    }
    visiting.add(feature.id)
    for (const dep of feature.dependencies ?? []) {
      visit(byId.get(dep)!)
    }
    visiting.delete(feature.id)

    feature.register(context)
    registered.add(feature.id)
  }

  for (const feature of features) visit(feature)
}

/** A `FeatureRegistrationContext` that accumulates registrations into plain arrays. */
export function createCollectingContext(): FeatureRegistrationContext & {
  nav: NavEntry[]
  healthChecks: HealthCheck[]
} {
  const nav: NavEntry[] = []
  const healthChecks: HealthCheck[] = []
  return {
    nav,
    healthChecks,
    registerNav: (entry) => nav.push(entry),
    registerHealthCheck: (check) => healthChecks.push(check),
  }
}
