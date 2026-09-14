---
id: ADR-001
type: adr
status: active
tier: T1
properties: [executable, composable]
obligations: 0
depends_on: []
---

# ADR-001: Use SQLite as the sole storage backend

**Date:** 2026-03-21
**Status:** Accepted (2026-09-10) — the search half is amended by ADR-014
**Amended by:** @docs/adrs/active/ADR-014-keyword-first-recall.md

## Status

Accepted. Held `Proposed` for five months while fully implemented, which is decision debt,
not deliberation — recorded in `docs/gs-assessment.md` as the signal that no gate was
comparing ADR status to shipped code.

**The storage decision below is in force.** The *search* decision below (FTS5 for keyword
search, in-process cosine similarity for recall) was never implemented: recall uses
`content LIKE ?`, and the embedding column has no recall consumer. Read ADR-014 for what
is actually built and why. Do not implement against the search paragraph of this ADR.

Two further corrections of record: the database is `~/.chronicle/chronicle.db`, not
`memory.db`; and the intelligence-layer YAML artifacts named below are specified but not
yet emitted.

## Context

Chronicle is a local-first MCP server with strict cold-start (<200ms) and recall (<50ms for 10k memories) performance requirements. The storage layer must support full-text search (FTS5), semantic vector similarity, decay-weight queries, and tier promotion — all without a network round-trip, cloud dependency, or migration runner.

## Decision

Use better-sqlite3 with FTS5 extension for keyword search and a float[] column for vector embeddings, queried in-process with cosine similarity. Persist to ~/.chronicle/memory.db. Intelligence-layer artifacts (profile.yaml, lessons.yaml, playbook.yaml) are written as YAML files alongside the database.

## Alternatives Considered

- Prisma + PostgreSQL: rejected — requires a running server, adds 4MB to bundle, breaks local-first guarantee.
- Prisma + SQLite: rejected — async driver adds 15-30ms overhead per query, violates <50ms recall SLA; migration runner is unnecessary complexity for a single-user embedded DB.
- LanceDB (vector-native): rejected — no FTS5, no synchronous Node.js API, larger binary footprint than better-sqlite3.
- Memory-only (in-process Map): rejected — no persistence across restarts, violates cross-session continuity requirement.

## Consequences

Positive: synchronous API eliminates async overhead; single file is trivially backed up; FTS5 + vector in one query avoids a join across stores. Negative: vector search is O(n) in-process (acceptable up to ~100k memories); no concurrent write access (acceptable for single-user local tool); manual migration scripts required if schema changes.
