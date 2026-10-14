# Authentication

**Feature ID:** `authentication`  
**Owner:** Feature team  
**Status:** Draft (PRD v0.2)

## Purpose and scope

Better Auth passkey and email OTP (Mailgun), session handling and identity mapping. Google login deferred.

## User stories

- As a workspace owner, I want to use authentication so that I can manage accurate, traceable finances.

## Functional requirements

1. Email OTP (sent via Mailgun) supports registration, login and recovery; passkeys are the primary login. Google OAuth is deferred until other users can sign up.
2. Link additional auth methods only following verified ownership; secure all endpoints and streaming sessions.
3. Do not rely solely on frontend route guards for access control.
4. Registration can be restricted to an allowlist of emails (`ALLOWED_SIGNUP_EMAILS`) while the app has a single owner.
5. Without Mailgun credentials (local development), OTP emails are written to the web server log instead of being sent.

## Owned contracts and data

This feature owns its corresponding domain policies and primary records as described in [the PRD](../PRD.md). It must scope domain records to workspace, retain provenance where imported, use shared schemas in `packages/contracts`, and expose typed interfaces to other features.

## Failure modes and edge cases

- Reject cross-workspace requests, including direct file/object access.
- Keep source records/audit history on soft deletion; never silently fabricate financial values.
- Surface unsupported imports, conflicts, and inconsistent input for explicit review.

## Acceptance criteria

- OTP and passkey login work.
- Expired/unauthorised users cannot fetch finance data or object URLs.

## Testing notes

- Add domain unit tests, integration tests with PostgreSQL where persistence is involved, and one end-to-end user-path test.
- Exercise source replay, idempotence, and negative authorisation paths where relevant.

## Interactions with **all** other registered features

**Rule:** Every new feature must be added to this table, even if its relationship is `None`. Reciprocal documentation must be updated in the other feature.

| Other feature | Interaction | Direction / contract |
|---|---|---|
| [Core / Workspaces](00-core-workspaces.md) | Integration | Verified Better Auth identity resolves the single default owner workspace. |
| [Financial Accounts](02-financial-accounts.md) | Integration | Session middleware authorises financial account commands and reads. |
| [Source Files / Statements](03-source-files-statements.md) | Integration | Session-bound permissions protect PDF/CSV uploads and private RustFS downloads. |
| [Import Processing](04-import-processing.md) | Integration | SSE subscriptions and job status reads are authenticated, not just UI-gated. |
| [Transactions](05-transactions.md) | None | No direct interaction in v0.2; review if either feature changes scope. |
| [Events and Legs](06-events.md) | None | No direct interaction in v0.2; review if either feature changes scope. |
| [Reconciliation](07-reconciliation.md) | None | No direct interaction in v0.2; review if either feature changes scope. |
| [Financial Instruments](08-instruments.md) | None | No direct interaction in v0.2; review if either feature changes scope. |
| [Asset Price History](09-asset-price-history.md) | None | No direct interaction in v0.2; review if either feature changes scope. |
| [Investment Holdings](10-holdings.md) | None | No direct interaction in v0.2; review if either feature changes scope. |
| [Valuation and FX](11-valuation-fx.md) | None | No direct interaction in v0.2; review if either feature changes scope. |
| [Manual Accounts](12-manual-accounts.md) | None | No direct interaction in v0.2; review if either feature changes scope. |
| [Financial Dashboard](13-dashboard.md) | Integration | Dashboard server functions verify owner access before financial aggregates are returned. |
| [Categories and Sankey](14-categories.md) | None | No direct interaction in v0.2; review if either feature changes scope. |

## Changes requiring reciprocal documentation

On creation or modification of a feature, amend this interaction table and corresponding rows in each linked feature document. A new feature requires an entry in **every existing feature file**. Also review its acceptance criteria, PRD scope, ADR decisions, and glossary.
