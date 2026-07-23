import { createFileRoute } from '@tanstack/react-router'
import { runHealthChecks } from '~/core/health'
import { appHealthChecks } from '~/app/features'

// Liveness/readiness probe for the core platform (database connectivity, plus
// any feature-registered checks — see `~/core/features` and `getAppFeatures()`
// in `~/app/features`).
export const Route = createFileRoute('/api/health')({
  server: {
    handlers: {
      GET: async () => {
        const report = await runHealthChecks(appHealthChecks)
        return new Response(JSON.stringify(report), {
          status: report.ok ? 200 : 503,
          headers: { 'content-type': 'application/json' },
        })
      },
    },
  },
})
