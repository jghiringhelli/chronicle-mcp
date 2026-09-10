---
id: TECHSPEC
type: spec-section
status: active
tier: T1
properties: [composable, executable]
obligations: 7
generative_execution: unrun
depends_on: [SPEC, ADR-001, ADR-011, ADR-014]
---

# Tech Spec — Chronicle

> **Scope of this document.** The technical contract: the layer map, the wire surface, the
> persisted shapes, and the risks. It **derives from** `docs/spec.md` and does not compete with
> it — where the two disagree, `spec.md` wins (ADR-013).
>
> This file replaces an unfilled ForgeCraft template.

## Overview

Chronicle is a single Node process that speaks MCP over stdio (optionally HTTP for the local
dashboard) and owns one SQLite file. No server, no daemon, no network in any hot path. The
architecture is hexagonal: a sealed domain, services that depend on ports, and adapters wired
only at the composition root. That shape is not decoration — it is what lets the SQLite
repository be swapped for an in-memory fake in tests, and what keeps the decay formula
testable without a database.

## Architecture

### Layer map and dependency direction

```
  src/cli.ts  ·  src/lib/index.ts            composition roots — the ONLY place concretes are wired
        │
        ▼
  src/mcp/server.ts  ·  src/dashboard/server.ts     delivery: 3 MCP tools (ADR-011), read-only HTTP
        │
        ▼
  src/services/*                              orchestration — depends on ports, never adapters
        │
        ├──────────────▶ src/ports/**         interfaces owned by the inside
        │                      ▲
        │                      │ implements
        │              src/adapters/**  ·  src/infrastructure/**
        ▼
  src/domain/**                                pure: entities, types, formulas. Zero imports.
```

**Contract.** `src/domain/` MUST import nothing — not an adapter, not a service, not
`node:*`, not `better-sqlite3`. `src/services/` MUST depend on `src/ports/`, never on
`src/adapters/`. Both rules are enforced by `no-restricted-imports` in `eslint.config.js`, and
acyclicity by `import/no-cycle` — so a layer violation fails `pnpm run lint` rather than
passing review.

### Component responsibilities

| Component | Owns | EDR |
|---|---|---|
| `domain/entities/memory.ts`, `domain/types.ts` | weight, decay, tier seeding, reinforcement | EDR-001 |
| `adapters/repositories/sqlite-memory-repository.ts` | the only SQL against `memories` | EDR-002 |
| `services/sync.ts` | optional Postgres mirror, boundary-triggered | EDR-003 |
| `services/coordination-service.ts` | the whole team layer behind `axon` | EDR-004 |
| `services/memory-service.ts`, `session-service.ts`, `trigger-service.ts`, `preference-service.ts` | orchestration per concern | — |
| `mcp/server.ts` | the three tools and action dispatch | ADR-011 |
| `dashboard/server.ts` | read-only localhost HTTP view | — |
| `shared/config/`, `shared/exceptions/` | config from `~/.chronicle/config.json`; `ChronicleError` hierarchy | — |

### Tech stack

| Concern | Choice | Locked by |
|---|---|---|
| Language / runtime | TypeScript 5.4+, Node 20 (`>=20 <24`), ESM | `docs/dependency-policy.md` |
| Storage | `better-sqlite3@^11`, **synchronous** | ADR-001 |
| Optional mirror | `postgres@^3.4` | ADR-010 |
| Protocol | `@modelcontextprotocol/sdk@^1` + `zod@^4` schemas | ADR-011 |
| Build / test | `tsup`, `vitest`, `@stryker-mutator/*` | `.claude/standards/testing.md` |

**Node 20 is a hard pin, not a preference.** `better-sqlite3@11` publishes no prebuild for
Node 24, and the failure mode is a runtime bindings error that reads like a code bug
(`.claude/ledger.md`).

## Data flow

**Write** — `chronicle(action: 'remember')` → `MemoryService` → `createMemory()` derives
weight, decay rate and tier from the type → `SqliteMemoryRepository.create()`. Synchronous end
to end; the call returns after the row is committed. An embedding, if a gateway is wired, is
attached afterwards and never awaited in this path.

**Read** — `chronicle(action: 'recall')` → `MemoryService` → one parameterised `SELECT` with
`LIKE` predicates, ordered by `weight DESC`, capped at `limit` (default 20) → each returned
memory is reinforced (`RECALL_HIT`, +0.15) and its `last_accessed_at` updated.

**Session boundary** — `session(action: 'start')` pulls (if configured) and injects Core
memories; `session(action: 'end')` runs decay and tier promotion, persists a summary, then
pushes. **Sync happens only here** — never inside a recall path (ADR-010 §4).

## Interface contracts

### MCP surface

Three registered tools dispatching on `action` (ADR-011). The tool name, the action names, and
the argument names are a **public surface**: changing one is a breaking change requiring the
public-surface diff in `.claude/standards/api.md`.

| Tool | Actions |
|---|---|
| `chronicle` | `remember` `recall` `forget` `trigger` `check` `pref` `prefs` `stats` `decay` |
| `session` | `start` `end` `recover` |
| `axon` | `contributor_add` `spec_sync` `milestone_add` `decompose` `assign` `complete` `request_merge` `resolve_merge` `merges` `status` `queue` |

Arguments are validated by `zod` schemas at the tool boundary. Because dispatch is on a string,
an unknown `action` fails in the handler rather than at schema validation — the handler MUST
therefore reject it with the list of valid actions, never silently no-op.

### Persisted shapes

Local (`~/.chronicle/chronicle.db`, `src/infrastructure/db/schema.ts`): `memories`, `sessions`,
`triggers`, `preferences`, `solutions`, `insights`, `sync_cursor`, plus the team tables
`contributors`, `work_packages`, `merge_requests`, `assignments`.

Cloud mirror (`src/infrastructure/db/cloud-schema.sql`, optional): `users`, `memories`,
`insights`, `session_summaries`, `sync_cursor`.

**Invariants.**

1. `memory_type` and `tier` are persisted strings from closed unions. Adding or removing a
   member requires an ADR **and** a migration (ADR-012 §2).
2. `tags` is a JSON array string, default `'[]'`, never `NULL`.
3. `embedding` is a little-endian `Float32Array` in a BLOB. Decoding MUST pass
   `byteOffset` — Node pools Buffers, and omitting it reads a neighbouring row's bytes
   (EDR-002).
4. Every timestamp is `Date.toISOString()`. Sync compares these **lexicographically**, so a
   writer emitting a local offset would silently lose updates (EDR-003).
5. `buffer`-tier memories are never pushed to the mirror.

### Error contract

`ChronicleError` with six subclasses (`src/shared/exceptions/`). A storage failure MUST surface
as `StorageError` with the original error as its cause; a raw `SqliteError` MUST NOT cross the
repository boundary. Domain code MUST NOT return transport status codes.

## Security and compliance

Local-first and single-tenant: the threat model is a local file, not a network service.

- No telemetry, no analytics, no outbound call unless `railwayUrl` is explicitly configured
  (`docs/spec.md` NFR-05). A telemetry dependency is forbidden by the dependency policy.
- Secrets live in `~/.chronicle/config.json` outside the repository; `.env` is never committed,
  and a pre-commit secrets scan gates the staged diff.
- All SQL is parameterised. No interpolation of caller input, anywhere.
- The dashboard binds localhost and is read-only. It is not an authenticated surface and MUST
  NOT be exposed beyond the loopback interface.
- Memory content is whatever the developer stored and MAY contain sensitive project detail.
  It is never transmitted unless the mirror is configured — which is why the mirror is opt-in.
- Supply chain: `pnpm audit --prod --audit-level=high` must be clean, plus the approved-library
  check. Both gated in CI (`docs/dependency-policy.md`).

## Dependencies

Pinned and justified in `docs/dependency-policy.md`, enforced by
`scripts/check-dependency-policy.mjs`. Runtime surface is four packages.

## Risks and mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| NFR-03 (<50ms at 10k) fails: leading-wildcard `LIKE` cannot use an index | H | M | Marked *unrun* rather than claimed; FTS5 is the planned fix (ADR-014 §3). Needs a benchmark in `docs/evidence/`. |
| Native binding mismatch breaks install on a new Node major | H | H | `engines` is a closed interval; CI pins Node 20; the trap is documented in `.claude/ledger.md`. |
| `sync.ts` (522 lines) and `coordination-service.ts` (771 lines) have **zero tests** | H | H | EDR-003/EDR-004 name the minimum test set; P1 in `docs/gs-assessment.md`. |
| Lexical recall misses a differently-worded query | M | M | Known limitation, recorded in ADR-014 rather than papered over. |
| Pre-v0.2 rows carry `memory_type = 'session'`, now unreadable | M | M | Migration required by ADR-012 §2; not yet written — tracked, not silent. |
| Mirror conflict policy loses an update if a writer emits a local-offset timestamp | L | H | Invariant 4 above; a single `toISOString()` convention on every write path. |
| `conflicts` in `SyncResult` is always `0` and looks like a signal | M | L | EDR-003 says so explicitly: either count the discards or remove the field. |
