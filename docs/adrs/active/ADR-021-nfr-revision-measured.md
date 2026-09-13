---
id: ADR-021
type: adr
status: active
tier: T1
properties: [executable, verifiable, auditable]
obligations: 6
depends_on: [SPEC, EDR-001, EDR-002]
---

# ADR-021: Revise NFR-02 to a measured budget; keep NFR-03 and NFR-04 as written

**Date:** 2026-09-12
**Status:** Accepted
**Amends:** `docs/spec.md §5` — NFR-02's target

## Context

The three latency NFRs had been published since March and never measured (RM-104). `scripts/bench-nfr.mjs`
measured them over the real MCP boundary, at 1k / 10k / 50k memories, with a fixed seed and the
machine recorded. Results:

| NFR | Target | Measured | |
|---|---|---|---|
| NFR-02 cold start | <200ms | **251ms** | misses |
| NFR-03 recall at 10k | <50ms | **p95 13ms** | meets, with room |
| NFR-04 decay pass at 50k | <500ms | **10,386ms**, then **363ms** after the fix | meets |

Two of the three findings contradicted expectations, which is the argument for measuring rather than
reasoning:

**NFR-03 was predicted to fail and does not.** EDR-002 records that recall is a leading-wildcard
`LIKE`, which cannot use an index, so the predicate is a full scan — and since ADR-018 a default
recall runs *two* queries per call. The prediction in ADR-014 §3 was that the <50ms budget was at
risk. Measured, p95 is 13ms at the specified 10k and 24ms at 50k. The scan is real and it is simply
not the dominant cost at this scale. **FTS5 is therefore not urgent**, and ADR-014 §3 should be read
with that correction.

**NFR-04 failed by 20× and was a genuine defect.** The session-end pass took 10.4 seconds at 50,000
memories, because `applyDecay` looped and called `update()` per row and `better-sqlite3` autocommits
every statement — tens of thousands of transactions. Fixed in three steps, each measured:
10,386ms → 1,084ms (one transaction) → 679ms (decay as a single `UPDATE … exp()` in SQLite, which
ships `exp()` since 3.35) → **363ms** (promotions set-based too). That is a 28× improvement on a path
that runs at the end of every session.

**NFR-02's 200ms is not reachable, and the reason is not ours.** Measured on this machine:

| | cost |
|---|---|
| bare `node` startup | ~65ms |
| + importing any `@modelcontextprotocol/sdk` server entrypoint | ~165ms |
| + Chronicle's own modules | ~238ms |
| + opening the database, schema gate, handshake, first answer | ~251ms |

The SDK costs ~100ms on its own, and the low-level `server/index.js` entrypoint is **not** cheaper
than the high-level `server/mcp.js` (165.8ms vs 164.8ms) — so the obvious refactor buys nothing. That
leaves roughly 35ms for the entire application inside a 200ms budget, which is not a target, it is a
wish.

A schema-version gate was added during this work on the theory that ~36 `CREATE … IF NOT EXISTS`
statements per start were material. Measured: they were not — cold start did not move. The gate is
kept because it is correct and cheap, but it is recorded here as an optimisation that did not address
the bottleneck, which is worth saying rather than implying it helped.

## Decision

1. **NFR-02 becomes `< 300ms`**, and the spec records the measured breakdown beside it so the number
   is defensible rather than another round one. 251ms measured, 300ms as the budget that leaves room
   for a slower machine without being meaningless.
2. **NFR-02 is annotated as dependency-dominated.** Roughly 165ms of any measurement is Node plus the
   MCP SDK. A future tightening requires either a lighter protocol layer or lazy-loading the SDK
   behind the first request, and neither is worth doing for a process spawned once per session —
   where 250ms is imperceptible. That is the real reason the original 200ms was arbitrary: it was
   not derived from anything a user notices.
3. **NFR-03 and NFR-04 stay as written.** Both are met; changing a target that is met would only
   weaken it.
4. **Every NFR row now carries its measurement, the machine and the date**, not just a verdict. A
   target with no conditions is not reproducible, and the point of RM-104 was to stop quoting numbers
   nobody had run.
5. **`scripts/bench-nfr.mjs` is the gate for these claims.** Re-run it before changing anything on the
   recall or session-end path, and commit the record. It uses a fixed seed and a throwaway
   `CHRONICLE_HOME`, so it never touches a real store.
6. **ADR-014 §3's urgency is corrected, not its decision.** Keyword-first recall stands; FTS5 remains
   the planned replacement, now on evidence that it is not blocking.

## Alternatives Considered

- **Keep NFR-02 at 200ms and record it as permanently missed.** Rejected: a target nobody intends to
  reach trains readers to ignore the table. If it is not going to be met, it is not a requirement.
- **Lazy-load the SDK to get under 200ms.** Technically possible — defer the import until the first
  request — but it moves the cost rather than removing it, and it moves it to where a user is actually
  waiting for an answer instead of to startup. Worse for the same total.
- **Replace the MCP SDK with a minimal protocol implementation.** Rejected as disproportionate: it
  would buy ~100ms of startup on a once-per-session process, at the cost of owning a protocol
  implementation.
- **Raise NFR-04's target instead of fixing the code.** Rejected, and worth naming as the temptation:
  the 20× miss was a real defect in a real hot path, and moving the line would have hidden it. The
  fix was cheaper than the rationalisation.

## Consequences

**Positive.** The NFR table now contains measurements instead of aspirations, with the conditions that
make them reproducible. The session-end path is 28× faster. The FTS5 question is settled with evidence
rather than suspicion.

**Negative.** Two implementations of the decay formula now exist — `decayMemory()` in the domain and
the SQL in `decayOlderThan()` — which is duplication of exactly the kind that drifts silently. It is
accepted because the set-based version is what makes NFR-04 achievable, and it is guarded by
`tests/unit/adapters/sqlite-decay-parity.test.ts`, which pins the two to the same answer to nine
decimal places across a range of ages, weights and memory types. If that test is ever weakened, the
duplication becomes a liability.

Promotions moved into SQL too, which means the tier rules exist in a `WHERE` clause as well as in
`DEFAULT_TIERS`. The order is load-bearing and easy to get wrong: `working → core` runs **before**
`buffer → working`, so a memory cannot cross two tiers in one pass.

`SCHEMA_VERSION` is now a thing to remember to bump. `tests/unit/infrastructure/schema.test.ts` pins it
to a fingerprint of the schema text, so forgetting fails the build with the value to use — but that
test is the only thing standing between a schema change and a database that silently never receives it.

## Verification

- `scripts/bench-nfr.mjs --full` → `docs/evidence/nfr-bench.json`, carrying the machine, CPU model,
  Node version, seed and store sizes.
- `tests/unit/adapters/sqlite-decay-parity.test.ts` — 12 tests binding the SQL decay to the domain
  formula, including the permanence of `procedural`, `architectural` and `insight`.
- `tests/unit/infrastructure/schema.test.ts` — 8 tests on the version gate, including that a failed
  apply leaves the version unstamped so the next start retries.
- **Not measured:** a slower machine. Every number here is from one 20-core Windows host; a CI matrix
  would say whether 300ms holds on a modest runner, and until it does, NFR-02 is a budget from one
  machine.
