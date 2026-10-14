# ADR 0004 — PostgreSQL job queue and durable SSE status

**Status:** Accepted  
**Date:** 2026-10-13

## Decision

Use PostgreSQL jobs/job_progress tables, atomic SKIP LOCKED lease claiming, heartbeat, retry/backoff and failed-state recording. Workers are independent Bun processes. SSE streams persisted job progress records, with cursor-based reconnection.

## Context and rationale

Avoids operating a separate broker while supporting durable asynchronous work.

## Consequences and follow-up

Long-running parser jobs must not hold row locks; implement leases and idempotent commit.

## Related specification

- [PRD](../PRD.md)
- [Feature specifications](../features/)
