# Finance App v0.2 — Documentation Pack

This pack contains the updated product requirements, initial ADRs and a per-feature documentation registry.

- [PRD](docs/PRD.md)
- [Glossary](docs/glossary.md)
- [ADRs](docs/ADR/)
- [Feature specs](docs/features/)

**Repository requirement:** the entire `docs/` folder belongs at the top level of the Bun monorepo. This archive provides documentation, not an implemented application.

**Features and document governance:** each feature file lists **all other registered features**, including `None` relationships. Adding a feature requires touching all existing feature files. The included validator checks completeness and broken/missing entries; semantic accuracy still requires review.

Run `bun scripts/validate-feature-docs.ts` from the repository root once copied into a Bun project.
