/** A navigation entry a feature contributes to the app shell's sidebar. */
export interface NavEntry {
  to: string
  label: string
  /** Only match the route exactly (not its sub-routes) when highlighting the active link. */
  exact?: boolean
  /** Only shown when the app is running in development mode. */
  devOnly?: boolean
}

/** A named health check a feature contributes (see `~/core/health`). */
export interface HealthCheck {
  name: string
  check(): Promise<{ ok: boolean; detail?: string }>
}

/**
 * Extension points a feature can register against during app bootstrap.
 * Routes are still discovered by TanStack Start's file-based routing under
 * `src/routes/` (a framework requirement — see ADR 0007), so this context
 * covers the extension points routing can't: navigation, health checks, and
 * (as the scaffold grows) things like background jobs or permission grants.
 */
export interface FeatureRegistrationContext {
  registerNav(entry: NavEntry): void
  registerHealthCheck(check: HealthCheck): void
}

/**
 * Public metadata + registration lifecycle every feature implements.
 * `id` must be unique across the app. `dependencies` names other feature ids
 * that must be registered first — see `~/core/features/registry`.
 */
export interface AppFeature {
  readonly id: string
  readonly dependencies?: readonly string[]
  register(context: FeatureRegistrationContext): void
}
