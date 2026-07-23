# 0001 — Use TanStack Start

## Status

Accepted

## Context

The scaffold needs a full-stack web application framework: SSR, file-based routing, and a way
to co-locate server logic (data loading, mutations) with the routes and components that use
it, in TypeScript, with strong typing end-to-end.

## Decision

Use [TanStack Start](https://tanstack.com/start) (React 19) with TanStack Router (file-based
routing under `src/routes/`) and TanStack Query for client-side data/cache management.
Server-side logic is expressed as `createServerFn`/route `server.handlers`, colocated with the
routes and components that call them.

## Consequences

- File-based routing under `src/routes/` is a framework requirement — this is why feature
  route _implementations_ live under a feature's own `ui/`/`domain/` and are wired into thin
  route files, rather than routes physically living inside `src/features/<name>/routes/` as
  the "suggested source structure" shows (see
  [ADR 0007](0007-core-shared-feature-boundaries.md)).
- Server-only code (Node built-ins, database drivers) must be kept out of route files' client
  bundle carefully — TanStack Start's compiler extracts `createServerFn` handler bodies, but a
  **static** re-export of a server-only module from a barrel `index.ts` can still defeat that
  extraction and pull the module into the client bundle (see the imports feature's PDF
  registry, which is reached only via a dynamic `import()` for exactly this reason).
- Fully typed routes, loaders, and search params end-to-end with no codegen step beyond the
  router's own route-tree generation.

## Alternatives considered

- **Next.js (App Router)** — mature, larger ecosystem, but its data-fetching model (Server
  Components, route handlers) is a different shape than the TanStack Router/Query pairing this
  scaffold's feature registration and route-composition conventions are built around.
- **Remix** — similar loader/action model to TanStack Start; TanStack Start was chosen for its
  tighter TanStack Router/Query integration and fully-typed route tree.
- **A separate API server + SPA** — rejected: doubles deployment complexity and loses
  colocated, typed server functions for comparatively little benefit at this scale.

## Related features or ADRs

- [ADR 0004 — Feature-oriented architecture](0004-feature-oriented-architecture.md)
- [ADR 0007 — Boundaries between core, shared, and features](0007-core-shared-feature-boundaries.md)
