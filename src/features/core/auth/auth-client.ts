import { createAuthClient } from 'better-auth/react'
import { magicLinkClient } from 'better-auth/client/plugins'
import { passkeyClient } from '@better-auth/passkey/client'

// React framework client. `createAuthClient` lives in `better-auth/react`;
// the `better-auth/tanstack-start` entrypoint only provides the server-side
// cookie plugin (used in `~/lib/auth`). baseURL defaults to the current origin.
export const authClient = createAuthClient({
  plugins: [magicLinkClient(), passkeyClient()],
})
