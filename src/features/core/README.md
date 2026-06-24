# Core Feature

## Summary
The foundational feature that provides authentication, workspace management, and the app shell (sidebar, user menu, root document). Every other feature depends on core. Core is always enabled and cannot be toggled off.

## Tables owned
| Table | Purpose |
|-------|---------|
| `users` | User accounts |
| `sessions` | Better Auth sessions |
| `auth_accounts` | Better Auth OAuth/magic-link accounts |
| `verifications` | Magic link tokens |
| `passkeys` | WebAuthn passkeys |
| `workspaces` | Workspace records |
| `workspace_members` | User ↔ workspace membership |

## Nav
Core registers no nav links — it provides the app shell itself. The sidebar reads nav links from the plugin registry (`registry.getNavLinks()`), which is populated by other features.

## Cross-feature dependencies
None. Other features depend on core, not the reverse.

## Toggle
Core cannot be disabled. Commenting out its import in `src/features/index.ts` would break the app shell.

## Key files
- `app-shell.tsx` — Sidebar, UserMenu, RootDocument (reads nav links from registry)
- `login-page.tsx` — Magic link + passkey sign-in page
- `settings-page.tsx` — Account settings, passkey management
- `workspaces-page.tsx` — Workspace management, member invites
- `auth/auth.ts` — Better Auth server instance
- `auth/auth-client.ts` — Better Auth React client
- `auth/auth-guard.ts` — `fetchAuthUser` server fn used by route guards
- `schema.ts` — Drizzle table definitions for all core tables
