# Core

## Summary

The core platform (`src/core/`) provides the shared capabilities every feature depends on:
authentication and session resolution, workspaces (multi-tenancy), typed configuration,
logging, typed errors, authorization primitives, the feature registration system, health
checks, and testing utilities. It contains no application-specific business logic — see
[ADR 0007](../adr/0007-core-shared-feature-boundaries.md).

## Goals

- Give every feature a single, consistent way to authenticate a user, resolve their workspace,
  read config, log, and throw typed errors.
- Keep sign-in methods (magic link, passkey, SSO) independently togglable per application via
  environment variables, with no code changes required to disable one.
- Make feature registration explicit and validated, so a missing or circular dependency fails
  the app at boot rather than at some unpredictable point at runtime.
- Stay small. If a capability is specific to one feature's business rules, it belongs in that
  feature, not here.

## Non-goals

- Core does not implement business features (accounts, transactions, categories, …) — see the
  other documents in this directory.
- Core does not prescribe a specific email provider, SSO identity provider, or object-storage
  vendor — those are environment-driven choices left to the application.

## Domain terminology

See the [glossary](../glossary.md): **core platform**, **workspace**, **request context**,
**feature registration**.

## Functional requirements

### Authentication (`src/core/auth/`)

Authentication uses [Better Auth](https://better-auth.com). There are no passwords. Each
sign-in method is independently enabled/disabled via environment variables (see
`src/core/config/env.ts`):

- **Magic link** (`AUTH_MAGIC_LINK_ENABLED`, default on) — user enters an email at `/login`;
  Better Auth generates a one-time token (`verifications` table) and the app logs the
  sign-in link (via `~/core/logging`) rather than emailing it, since no transactional email
  provider is wired up by default — swap `sendMagicLink` in `src/core/auth/auth.ts` for a real
  send (Resend, SES, Postmark, …) in production. Clicking the link verifies the token, creates
  or reuses the user, and sets a session cookie. New users get a name defaulted from the email
  local-part and `emailVerified = true`.
- **WebAuthn passkeys** (`AUTH_PASSKEY_ENABLED`, default on) — registered from `/settings`;
  `PASSKEY_RP_ID` (registrable domain) and `BETTER_AUTH_URL` (origin) must match the deployment
  or registration fails. Losing all passkeys still allows magic-link sign-in.
- **Single sign-on** (`AUTH_SSO_PROVIDERS_JSON`) — any number of externally-hosted identity
  providers via Better Auth's `genericOAuth` plugin, configured entirely from a JSON array in
  the environment (provider id, client id/secret, and either a discovery URL or explicit
  authorize/token/userinfo URLs). Empty/unset disables SSO with no code changes.

### Sessions (`src/core/session/`)

`getSession()` resolves the authenticated user, their current workspace, and a `RequestContext`
(`{ userId, workspaceId }`) threaded through every service call:

1. Extract the user id from the Better Auth session cookie.
2. Load the user record.
3. Resolve the current workspace from the `fd_workspace_id` cookie (one-year max-age,
   re-validated per request), falling back to the user's oldest workspace.

Routes gate themselves by calling `fetchAuthUser()` (`~/core/auth`) in `beforeLoad`, redirecting
unauthenticated visitors to `/login`.

### Workspaces (`src/core/workspaces/`)

Workspaces are the top-level, multi-tenant data boundary — every piece of business data a
feature creates belongs to exactly one workspace. A **personal workspace** is created
automatically on first sign-in (`"{name}'s Workspace"`, `isPersonal = true`); users can create
additional **shared workspaces** and invite other existing users to them.

Each member has a role: `owner` (full control, including membership) or `member` (full data
access, no membership management). Roles are fixed at assignment. The workspace creator is
always `owner`; the owner cannot be removed. Switching the active workspace (`/workspaces`, or
the sidebar switcher) is a cookie update — no data leaks between workspaces because every
service call is scoped by `RequestContext.workspaceId`.

### Settings (`/settings` route)

Authenticated users can update their display name, manage registered passkeys (add/remove),
view read-only account info (email, verified status, created date), and sign out (which also
clears the client-side query cache so cached data isn't visible to the next user on a shared
device).

### Configuration (`src/core/config/`)

`getEnv()` validates the environment once (Postgres connection, Better Auth secret/URL,
passkey RP id, optional S3 object-storage settings) and throws a readable, field-by-field
error if anything required is missing or malformed — meant to be called at real server boot
(the `/api/health` route's `environment` check calls it). Broadly-imported modules like
`~/core/auth/auth` read individual variables directly with safe fallbacks instead, so they stay
importable (e.g. by tests) in environments where the full config isn't set.

### Logging and errors (`src/core/logging/`, `src/core/errors/`)

`logger` (`~/core/logging`) is a small structured logger (`.info`/`.warn`/`.error`/`.debug`,
plus `.child()` for scoped context) that every feature can use instead of ad hoc `console.*`
calls. `~/core/errors` defines a typed `AppError` hierarchy (`NotFoundError`,
`UnauthorizedError`, `ForbiddenError`, `ValidationError`, `ConflictError`) with an HTTP status
on each, for code that wants to distinguish an expected, user-facing failure from an
unexpected bug.

### Authorization primitives (`src/core/permissions/`)

`assertRole(actual, allowed, message)` throws a `ForbiddenError` unless a role is in an allowed
set — intentionally generic (features define their own role types); used today by the
workspaces capability's owner-only operations.

### Feature registration (`src/core/features/`)

`AppFeature` is the typed contract every feature implements (`id`, optional `dependencies`,
`register(context)`). `registerFeatures()` validates that every declared dependency exists,
detects duplicate ids and dependency cycles, and calls each feature's `register()` in
dependency order — throwing `FeatureDependencyError` on any violation, so the app fails to
boot rather than run with a feature silently missing a dependency. See
`src/app/features.ts` for where the app's feature set is assembled.

### Health checks (`src/core/health/`)

`runHealthChecks()` aggregates the core checks (environment validity, database connectivity)
plus any feature-registered `HealthCheck`s and backs the `/api/health` route.

### Testing utilities (`src/core/testing/`)

Small helpers shared by integration tests across features — e.g.
`queryTestUserIdsByEmailDomain()`, used by test suites that seed data under a dedicated email
domain so their cleanup can scope deletes to only what they created.

## Responsibilities

- Application bootstrap and feature discovery/registration.
- Authentication, session resolution, and workspace (multi-tenant) data isolation.
- Database access (`src/core/database/`: Drizzle schema, client, pagination helper).
- Configuration and environment validation.
- Logging and typed error conventions.
- Authorization primitives.
- Health checks and testing utilities.

## Public contracts

- `~/core/auth` — `authClient`, `fetchAuthUser`. (`~/core/auth/auth` — the server-side Better
  Auth instance — is imported directly, never through the index, to keep it out of the client bundle.)
- `~/core/session` — `getSession`, `setCurrentWorkspaceId`, `createContext`, `RequestContext`, `Session`.
- `~/core/workspaces` — `workspaceService`, `createUserWithPersonalWorkspace`, `ensureDefaultWorkspace`.
- `~/core/database` — `db` (Drizzle client); `~/core/database/schema` — the shared schema; `~/core/database/pagination`.
- `~/core/config` — `getEnv`, `getSsoProviders`, `isMagicLinkEnabled`, `isPasskeyEnabled`.
- `~/core/logging` — `logger`.
- `~/core/errors` — `AppError` and subclasses, `isAppError`.
- `~/core/permissions` — `assertRole`, `ForbiddenError`.
- `~/core/features` — `AppFeature`, `FeatureRegistrationContext`, `registerFeatures`, `createCollectingContext`.
- `~/core/health` — `runHealthChecks`.
- `~/core/testing` — `queryTestUserIdsByEmailDomain`.

## Dependencies

None — core depends on nothing else in the app; everything else depends on it.

## Interactions with other features

Every feature imports session/workspace access from `~/core/session` and `~/core/workspaces`,
the shared schema from `~/core/database`, and (as needed) `~/core/config`, `~/core/logging`,
`~/core/errors`, and `~/core/permissions`. Features register themselves with
`~/core/features` in `src/app/features.ts`.

## Authorization and permissions

Session resolution establishes _authentication_ (who is signed in); workspace membership
establishes the _authorization_ boundary (what data they can see) via `RequestContext`.
Role-gated actions (e.g. workspace settings, member management) use `assertRole`.

## Data ownership

Core owns the `users`, `sessions`, `verifications`, `passkeys`, `auth_accounts`, `workspaces`,
and `workspace_members` tables.

## Failure modes

- Missing/invalid required environment variables — `getEnv()` throws with a field-by-field
  message; surfaced by the `/api/health` route's `environment` check.
- Mismatched `PASSKEY_RP_ID`/`BETTER_AUTH_URL` vs. the actual origin — passkey registration
  fails client-side.
- Unknown/circular feature dependencies — `registerFeatures()` throws `FeatureDependencyError`
  at bootstrap.
- No workspace resolvable for a signed-in user (should not happen — every user gets a personal
  workspace on creation) — `getSession()` returns `null`, treated as signed-out.

## Acceptance criteria

- A user can sign in via magic link and/or passkey (whichever are enabled) and land in their
  personal workspace on first sign-in.
- Disabling a sign-in method via its environment variable removes it from both the server
  (plugin not registered) and the login UI's available options.
- Configuring `AUTH_SSO_PROVIDERS_JSON` makes the corresponding provider(s) available for
  sign-in without any code changes.
- Registering a feature with an unknown or circular dependency causes the app to fail to boot
  with a clear error, not a silent misconfiguration.

## Open questions

- Should workspace roles support more than `owner`/`member` (e.g. a read-only role)? Left to
  applications that need it — the `assertRole` primitive already supports arbitrary role sets.

## Related architectural decisions

- [ADR 0003 — Selection of Better Auth](../adr/0003-use-better-auth.md)
- [ADR 0004 — Feature-oriented architecture](../adr/0004-feature-oriented-architecture.md)
- [ADR 0005 — Feature registration and dependency management](../adr/0005-feature-registration-and-dependencies.md)
- [ADR 0007 — Boundaries between core, shared, and features](../adr/0007-core-shared-feature-boundaries.md)
