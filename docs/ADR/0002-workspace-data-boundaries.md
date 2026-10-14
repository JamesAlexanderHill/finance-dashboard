# ADR 0002 — Workspace scoping from day one

**Status:** Accepted  
**Date:** 2026-10-13

## Decision

Create workspaces plus workspace_members. A new user receives one default owned workspace; only one member is supported by product flow in v1. Scope all financial records, imports, prices and dashboard queries by workspace.

## Context and rationale

Future-proofs shared workflows and provides predictable security boundaries.

## Consequences and follow-up

Every API, SSE, job and object operation needs explicit workspace auth; no member invites/UI in v1.

## Related specification

- [PRD](../PRD.md)
- [Feature specifications](../features/)
