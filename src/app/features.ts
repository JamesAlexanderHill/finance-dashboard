// Imported from each feature's `feature.ts` directly rather than its public
// `index.ts` — the index barrel also re-exports server-only domain code and
// client UI components side by side, and pulling that whole barrel in here
// would drag server-only modules (e.g. imports' dedupe hashing, which uses
// Node's `crypto`) into the client bundle purely for this metadata object.
import { accountsFeature } from '~/features/accounts/feature'
import { categoriesFeature } from '~/features/categories/feature'
import { relationsFeature } from '~/features/relations/feature'
import { transactionsFeature } from '~/features/transactions/feature'
import { importsFeature } from '~/features/imports/feature'
import { dashboardFeature } from '~/features/dashboard/feature'
import { devToolsFeature } from '~/features/dev-tools/feature'
import type { AppFeature } from '~/core/features'
import { registerFeatures, createCollectingContext } from '~/core/features'

/**
 * The application's feature set. This is the one place a new
 * application-specific feature gets wired in — add it here (and to its
 * `dependencies` list if it depends on another feature's public contract).
 */
export function getAppFeatures(): AppFeature[] {
  const features: AppFeature[] = [
    accountsFeature,
    categoriesFeature,
    relationsFeature,
    transactionsFeature,
    importsFeature,
    dashboardFeature,
  ]
  if (import.meta.env.DEV) features.push(devToolsFeature)
  return features
}

// Registered once at module load — `register()` calls are synchronous and only
// populate the arrays below, so this is safe to run on both server and client.
const context = createCollectingContext()
registerFeatures(getAppFeatures(), context)

/** Navigation entries contributed by every registered feature, in registration order. */
export const appNav = context.nav

/** Health checks contributed by every registered feature. */
export const appHealthChecks = context.healthChecks
