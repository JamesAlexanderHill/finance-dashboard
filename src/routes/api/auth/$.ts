import { createFileRoute } from '@tanstack/react-router'
import { auth } from '~/lib/auth'

// Catch-all server route that hands every /api/auth/* request to Better Auth
// (sign-in, magic-link verify, sign-out, get-session, …).
export const Route = createFileRoute('/api/auth/$')({
  server: {
    handlers: {
      GET: ({ request }) => auth.handler(request),
      POST: ({ request }) => auth.handler(request),
    },
  },
})
