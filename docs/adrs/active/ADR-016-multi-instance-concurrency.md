---
id: ADR-016
type: adr
status: active
tier: T2
properties: [executable, verifiable]
obligations: 6
depends_on: [ADR-001, ADR-015]
---

# ADR-016: Concurrent multi-instance access is a supported contract, not an accident

**Date:** 2026-09-10
**Status:** Accepted
**Amends:** ADR-001's consequence *"no concurrent write access (acceptable for single-user local tool)"*

## Context

Chronicle is registered as a **user-scope** MCP server, so every Claude Code instance on the
machine launches its own server process, and all of them open the same file:
`~/.chronicle/chronicle.db`. A developer with three terminals has three writers. This is not an
edge case — it is the normal way the tool is used, and it is the entire point of registering it at
user scope rather than per project.

ADR-001 explicitly listed the opposite as an accepted limitation: *"no concurrent write access
(acceptable for single-user local tool)."* That sentence was written when the only consumer was one
session at a time.

Inspecting the code against that claim produced a surprise worth recording, because the initial
diagnosis was wrong and the correction is the useful part:

- **`journal_mode = WAL` was already set**, and WAL is the one thing that actually matters: a file
  database otherwise opens with `journal_mode = delete`, where a reader blocks the writer. So
  multi-process access already worked.
- **`busy_timeout` did not need fixing either.** SQLite defaults it to 0, but `better-sqlite3`
  overrides that to 5000ms, and `foreign_keys` to ON. A first reading treated both as missing.

So the defect was never in the behaviour. It was that **nothing pinned any of it**. The pragma line
looked like redundant startup noise; deleting it would have passed every gate — typecheck, lint,
the full unit suite — while breaking every second instance. And the unit tests could not have
caught it even in principle, because they all use `:memory:`, where each connection gets a private
database and cross-connection behaviour is not representable.

## Decision

Multi-instance concurrent access is a **supported contract**, stated and tested.

1. `applyConcurrencyPragmas()` is extracted, exported and documented as the place this contract
   lives. `getDatabase()` calls it.
2. `journal_mode = WAL` MUST be set. It is the load-bearing pragma; without it a second instance
   contends with the first.
3. `busy_timeout` MUST be set **explicitly** to 5000ms rather than inherited. A driver default is
   not a contract: `better-sqlite3` happens to agree today, and if it changes, the test is what
   notices.
4. `synchronous = NORMAL` (down from SQLite's FULL). Safe under WAL — a power loss can cost the
   last commit, never the file — and it removes an fsync per transaction while a neighbouring
   instance may be mid-decay-pass. Chronicle stores memories, not money.
5. The schema exec MUST stay idempotent (`CREATE TABLE IF NOT EXISTS` throughout), because every
   instance runs it at startup. If the second instance's schema pass errored, the second instance
   could not start.
6. Sync to the cloud mirror MUST remain at session boundaries only (ADR-010 §4). Concurrent
   *local* access is supported; concurrent *push* from several instances is not, and the boundary
   rule is what keeps them from overlapping.

What is **not** claimed: multi-*user* or multi-*machine* write access to one file. The contract is
several processes belonging to one developer on one filesystem. Cross-machine convergence is the
cloud mirror's job (EDR-003), and its conflict policy is last-access-wins.

## Alternatives Considered

- **Leave it as ADR-001 stated and accept the limitation.** Rejected: it is no longer true, and a
  recorded limitation that contradicts how the tool is deployed is worse than none — the next
  session reads it and "fixes" the concurrency that was working.
- **Serialise access through a lockfile** (`~/.chronicle/.db.lock`). Rejected: WAL plus
  `busy_timeout` already gives serialised writes with concurrent reads, at the database level where
  it belongs. A lockfile adds a failure mode of its own — the stale lock after a crashed instance.
- **One database per project instead of one per user.** Rejected: it would remove the contention
  *and* the product. Cross-project recall is the reason Chronicle exists (UC-005).
- **A single shared server process** that all instances connect to. Rejected: MCP's stdio transport
  is one process per client by construction, and a daemon would need lifecycle management,
  discovery and an upgrade story — a large amount of machinery to avoid a problem SQLite solves.

## Consequences

**Positive.** The deployment the tool is actually used in is now the deployment it is specified and
tested for. Six tests pin it against two real connections to one real file. A future reader who
thinks the pragma block is noise is told otherwise by a failing test rather than by a comment.

**Negative.** Writes across instances are serialised, so a long write blocks others for its
duration — bounded by `busy_timeout`, beyond which a `StorageError` surfaces. Chronicle's writes are
single-statement and sub-millisecond, so the margin is large, but the session-end decay pass over a
large store is the one operation that could approach it, and it has never been measured at scale
(spec NFR-04 is *unrun*).

`synchronous = NORMAL` accepts losing the final commit on power loss. For a memory store that is a
good trade; it would not be for a ledger, and anyone reusing this code elsewhere should know it was
a choice.

## Verification

- `tests/unit/infrastructure/database-concurrency.test.ts` — 7 tests on a real temp-file database:
  the journal mode actually changes from `delete` to `wal`, `synchronous` is NORMAL (which fails if
  the pragma is dropped), a second connection reads the first's commit, a second connection writes
  while the first holds an open read cursor, and the schema exec is idempotent across connections.
- `scripts/smoke-mcp.mjs` — two **separate server processes** over stdio: instance B recalls what
  instance A wrote, and four interleaved reads/writes across both all succeed. 12/12, recorded in
  `docs/evidence/mcp-smoke.json`.
- **Not verified:** behaviour under real contention at scale (many instances, large store), and
  NFR-04's decay-pass timing, which is the one operation that could plausibly reach the timeout.
