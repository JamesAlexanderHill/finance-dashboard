# ADR 0001 — Use a Bun workspaces monorepo

**Status:** Accepted  
**Date:** 2026-10-13

## Decision

Run TanStack Start web and independent Bun worker in `apps/*`; reusable packages in `packages/*`; root `package.json` declares both workspace groups. Packages import other local packages using `workspace:*` and have explicit boundaries.

## Context and rationale

Keeps domain schemas, validation, parser code and service contracts consistent without copy/paste.

## Consequences and follow-up

Independent deployments still need per-app builds and runtime secrets; ensure no server code leaks to the browser.

## Related specification

- [PRD](../PRD.md)
- [Feature specifications](../features/)
