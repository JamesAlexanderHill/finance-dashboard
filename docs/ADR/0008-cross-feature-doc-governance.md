# ADR 0008 — Every feature doc describes all feature relationships

**Status:** Accepted  
**Date:** 2026-10-13

## Decision

Each feature Markdown file contains an interaction table row for every other registered feature, explicitly saying None if no direct integration. Any new feature updates all previous feature docs and related PRD/ADR/glossary. Add CI validation.

## Context and rationale

Keeps feature coupling visible to humans and AI coding agents over time.

## Consequences and follow-up

Adds documentation change burden; automation should validate completeness rather than generate misleading semantic interactions.

## Related specification

- [PRD](../PRD.md)
- [Feature specifications](../features/)
