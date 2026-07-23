# 0003 — Use Better Auth

## Status

Accepted

## Context

The scaffold needs authentication infrastructure supporting passwordless sign-in (magic link
and WebAuthn passkeys) and configurable single sign-on against external identity providers,
integrated with the existing Drizzle/Postgres setup, and treated as core platform
infrastructure rather than an ordinary feature (see [ADR 0007](0007-core-shared-feature-boundaries.md)).

## Decision

Use [Better Auth](https://better-auth.com) via its Drizzle adapter
(`better-auth/adapters/drizzle`), configured in `src/core/auth/auth.ts`:

- `magicLink` plugin for email magic-link sign-in.
- `@better-auth/passkey` for WebAuthn passkeys.
- `genericOAuth` plugin for SSO against any number of externally-hosted OIDC/OAuth providers,
  configured entirely from an environment variable (`AUTH_SSO_PROVIDERS_JSON`) rather than
  hardcoded provider list, so an application enables only the providers it needs.
- `tanstack-start` cookie plugin to persist Better Auth cookies from server functions/routes.

Each of the three sign-in methods is independently toggled via environment variables
(`AUTH_MAGIC_LINK_ENABLED`, `AUTH_PASSKEY_ENABLED`, `AUTH_SSO_PROVIDERS_JSON`) validated by
`~/core/config`.

## Consequences

- Better Auth's own tables (`sessions`, `verifications`, `passkeys`, and `account` — mapped to
  `auth_accounts` to avoid colliding with the app's own `accounts` table) live in the shared
  schema, owned by core, not any feature.
- The server-side `auth` instance (`~/core/auth/auth`) must never be imported through the
  `~/core/auth` public index — only directly, and lazily where possible (see
  `~/core/session/session.ts`'s dynamic import) — to keep Node-only Better Auth dependencies
  out of the client bundle.
- No password storage, no password-reset flow, no password-strength policy to maintain.
- Adding a new SSO provider is a configuration change, not a code change.

## Alternatives considered

- **Auth.js (NextAuth)** — mature and widely used, but more oriented around Next.js
  conventions; Better Auth's plugin model maps more directly onto "email magic link + passkey +
  configurable SSO" as three independent, composable plugins.
- **A hosted auth provider (Clerk, Auth0, Supabase Auth)** — simpler to stand up, but couples
  the scaffold to a specific vendor and its own user-data storage, working against the goal of
  a self-hostable, database-owned user model.
- **Hand-rolled sessions + WebAuthn** — rejected: reimplementing WebAuthn ceremony and
  magic-link token handling correctly and securely is significant, ongoing surface area for
  minimal benefit over an actively maintained library.

## Related features or ADRs

- [Core feature doc](../features/00-core.md)
- [ADR 0007 — Boundaries between core, shared, and features](0007-core-shared-feature-boundaries.md)
