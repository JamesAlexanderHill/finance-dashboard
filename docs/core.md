# Core

This document covers the foundational systems that underpin the app: authentication (how users sign in and manage sessions) and workspaces (how data is organized and shared between users).

## Authentication

The app uses [Better Auth](https://better-auth.com) for authentication, with two sign-in methods: magic links and WebAuthn passkeys. There are no passwords.

### Magic Link Login

1. User enters their email at `/login` and submits the form.
2. Better Auth generates a one-time verification token stored in the `verifications` table and sends a link to the user's email.
3. User clicks the link, which hits `/api/auth/magic-link/verify?token=<TOKEN>`.
4. Better Auth validates the token, creates or reuses the user account, and sets a session cookie (`better-auth.session_token`).
5. User is redirected to the app.

New users are created automatically on first sign-in. The user's name defaults to the local part of their email (e.g. `alice` from `alice@example.com`). The `emailVerified` flag is set to `true` automatically when a magic link is redeemed.

### WebAuthn Passkeys

Users can register passkeys (Touch ID, Face ID, hardware security keys) from `/settings` for passwordless biometric sign-in.

**Registration:**
1. User clicks "Add passkey" and optionally gives it a name (e.g. "MacBook Touch ID").
2. The browser initiates WebAuthn credential creation using the device's security module.
3. The credential is stored in the `passkeys` table with the public key, credential ID, counter (for replay protection), device type, and transport metadata.

**Sign-in:**
1. User clicks "Sign in with a passkey" on the login page.
2. The browser performs a WebAuthn assertion and sends it to the server.
3. The server verifies the assertion and establishes a session.

**Configuration:** The `PASSKEY_RP_ID` environment variable must be set to the registrable domain (e.g. `localhost` in development, `example.com` in production). The `BETTER_AUTH_URL` is used as the WebAuthn origin. Mismatched values will cause registration to fail.

If a user loses all their passkeys, they can still sign in via magic link and register new passkeys from settings.

### Sessions

Each authenticated request resolves a `Session` object containing the current user and workspace. The resolution flow:

1. Extract user ID from the `better-auth.session_token` cookie.
2. Load the user record from the `users` table.
3. Resolve the current workspace from the `fd_workspace_id` cookie, falling back to the user's oldest workspace if the cookie is missing or stale.

Sessions are stored in the `sessions` table (not JWTs) and include the user agent and IP address. The workspace cookie has a one-year max-age and is re-validated on every request.

Routes protect themselves by calling `fetchAuthUser()` in their `beforeLoad` hook, which redirects unauthenticated users to `/login`.

### Key Database Tables

| Table | Purpose |
|-------|---------|
| `users` | User profiles: name, email, `homeCurrencyCode`, `emailVerified` |
| `sessions` | Active session tokens with expiry, IP, and user agent |
| `verifications` | Temporary magic-link tokens with expiry |
| `passkeys` | WebAuthn credentials: public key, counter, device type, transports |
| `auth_accounts` | OAuth provider links (reserved for future use) |

### Environment Variables

| Variable | Description |
|----------|-------------|
| `BETTER_AUTH_SECRET` | 32+ character secret for signing tokens and cookies |
| `BETTER_AUTH_URL` | Base URL of the app (e.g. `https://example.com`) |
| `PASSKEY_RP_ID` | Registrable domain for WebAuthn (e.g. `example.com`) |

---

## Workspaces

Workspaces are the top-level containers for all financial data. Every account, instrument, category, event, and file belongs to exactly one workspace. Workspaces enable data isolation and optional multi-user collaboration.

### Personal and Shared Workspaces

When a new user signs in for the first time, a **personal workspace** is automatically created for them (named `"{name}'s Workspace"`, with `isPersonal = true`). This is always the fallback workspace.

Users can create additional **shared workspaces** from `/workspaces` and invite other users to collaborate. Members of a shared workspace all see the same accounts, events, and categories.

### Member Roles

Each workspace member has one of two roles:

| Role | Capabilities |
|------|-------------|
| `owner` | Full control: rename workspace, add/remove members, all data operations |
| `member` | Access and edit all workspace data; cannot manage membership or settings |

The workspace creator is automatically assigned the `owner` role. Invited users receive the `member` role. Roles cannot be changed after assignment. A member can remove themselves from a workspace; only the owner can remove other members. The owner cannot be removed.

### Workspace Switching

The sidebar displays a dropdown of all workspaces the user belongs to. Selecting a different workspace:

1. Updates the `fd_workspace_id` cookie to the new workspace ID.
2. Re-fetches all route data scoped to the new workspace.

All queries automatically filter by workspace via the `RequestContext` passed through every service call, so switching workspaces is an instant, cookie-driven context switch with no data leakage between workspaces.

### Adding Members

Only workspace owners can add members:

1. Owner navigates to `/workspaces` and enters a user's email.
2. The server looks up the user by email and inserts a row in `workspaceMembers` with `role = 'member'`.
3. The invited user immediately gains access when they next visit the workspace.

If the email does not match any existing user, an error is returned. Users must have already signed in at least once before they can be added to a shared workspace.

### Key Database Tables

| Table | Purpose |
|-------|---------|
| `workspaces` | `id`, `name`, `isPersonal`, `ownerId`, `createdAt` |
| `workspaceMembers` | Junction table: `(workspaceId, userId)` PK, `role` enum |
