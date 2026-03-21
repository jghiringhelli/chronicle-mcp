# chronicle — Core

> Always loaded. Contains only what is true across all domains.
> Hard limit: 50 lines. If it grows, move the excess to a domain node.

## Domain Identity
It solves the cold-start problem: every AI session begins with zero context about the developer's preferences, past decisions, and hard-won solutions. Chronicle models developer knowledge using five c

## Tags
[UNIVERSAL] [LIBRARY]

## Primary Entities
- ---
project:
  name: "Chronicle"
  id: "chronicle"
  created: "2026-03-03"
  sealed: "2026-03-03"

tech_stack:
  language: typescript
  runtime: "node.js >= 20"
  module_system: ESM
  build: tsup
  test: vitest
  storage: "sqlite (better-sqlite3) + vector embeddings"
  package_manager: npm
  publish: "npm (public)"

---

# Chronicle — Cross-Project AI Memory MCP Server

## 1.
- - **Decay rate**: ephemeral, 7-day TTL
- **Example**: *"Currently migrating auth to Lucia v3; decision pending on edge adapter vs database adapter."*
- **Primary tools**: `session_start()`, `session_end()`, `session_recover()`

### Architectural — Why it is built this way

Design decisions, trade-off rationale, constraints, and ADR-level records of alternatives considered and rejected.

## Layer Map
```
[API/CLI] → [Services] → [Domain] → [Repositories] → [Infrastructure]
Dependencies point inward. Domain has zero external imports.
```

## Invariants
- Every public function has a JSDoc with typed params and returns
- No circular imports (enforced by pre-commit hook)
- Test coverage ≥80% on all changed files