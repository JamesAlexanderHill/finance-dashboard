# ADR 0005 — RustFS for retained source files

**Status:** Accepted  
**Date:** 2026-10-13

## Decision

Store imported statement PDFs/CSVs and price CSVs in private RustFS S3-compatible storage, deployed under Docker Compose with persistent volumes and backup strategy. Database retains checksum, object key and status.

## Context and rationale

Provides a single source-file storage contract separate from relational models.

## Consequences and follow-up

Protect credentials; single-node storage is not inherently redundant. File retention is subject to future permanent account-erasure policy.

## Related specification

- [PRD](../PRD.md)
- [Feature specifications](../features/)
