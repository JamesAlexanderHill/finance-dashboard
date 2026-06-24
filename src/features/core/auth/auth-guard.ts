import { createServerFn } from '@tanstack/react-start'
import { getSession } from '~/db/services'

/**
 * Lightweight authenticated-user lookup for route guards (`beforeLoad`).
 * Returns `null` when signed out. The handler runs server-side only, so the
 * Better Auth instance never reaches the client bundle.
 */
export const fetchAuthUser = createServerFn({ method: 'GET' }).handler(async () => {
  const session = await getSession()
  if (!session) return null
  return { id: session.user.id, name: session.user.name, email: session.user.email }
})
