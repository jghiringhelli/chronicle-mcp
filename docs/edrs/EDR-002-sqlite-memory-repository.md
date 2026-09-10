---
id: EDR-002
type: edr
status: active
tier: T1
properties: [composable, executable]
obligations: 5
depends_on: [ADR-001, ADR-014]
---

# EDR-002: SQLite memory repository — keyword recall and row mapping

**Governs:** `src/adapters/repositories/sqlite-memory-repository.ts`,
`src/infrastructure/db/schema.ts`
**Derives from:** ADR-001 (SQLite as sole backend), ADR-014 (keyword-first recall)

## Function — what this unit does

The only code in the system that reads or writes the `memories` table. Implements
`MemoryRepository` (`src/ports/repositories/memory-repository.ts`) **synchronously** — no
promises anywhere in the signature.

| Operation | Guarantee |
|---|---|
| `create(memory)` | row inserted; returns the memory unchanged |
| `findById(id)` | the memory, or `undefined` — never throws on a miss |
| `recall(query)` | up to `limit` (default 20) results, ordered by `weight DESC`, each scored with its weight |
| `update(memory)` | full row replace |
| `attachEmbedding(id, embedding)` | embedding column written in place |

**Contract**

- Every failure MUST surface as `StorageError` with the original error as cause. A raw
  `SqliteError` MUST NOT escape this file — it is the layer boundary.
- All SQL MUST be parameterised. No string interpolation of caller input, ever.
- `recall` MUST be total: no match returns an empty array, not an error.
- Callers MUST NOT construct SQL, open a `Database`, or see a row shape. `MemoryRow` and
  `rowToMemory` are private to this module.
- A new filter on `RecallQuery` MUST be added as an `AND` condition and MUST have an index,
  or it turns the query into a scan.

## Implementation — how it does it

**Recall is `LIKE`, not FTS5, and the consequences are deliberate but temporary.** The query
splits the search string on whitespace and ORs `content LIKE '%word%' OR tags LIKE '%word%'`
per word, then ANDs the scalar filters (`project`, `category`, `memory_type IN`, `tier IN`)
and orders by `weight DESC`.

- A leading-wildcard `LIKE` **cannot use an index**. `idx_memories_weight` helps the ORDER BY,
  but the predicate itself is a full table scan: recall is O(rows), not O(log rows).
- Word matching is OR, so relevance does not increase with the number of matched words —
  a row matching one word of five ranks identically to a row matching all five. Ranking is
  `weight` alone: *how reinforced* the memory is, never *how well it matches*.
- `tags` is a JSON string column, so `tags LIKE '%x%'` also matches a tag *containing* `x`
  and can match content of a neighbouring field inside the JSON. Accepted as recall noise;
  it is never used for an authorisation or uniqueness decision.

**Why it stands anyway.** Zero dependencies beyond `better-sqlite3`, which is what makes the
zero-config cold start in UC-008 possible (ADR-014 §1). FTS5 is the planned replacement
(ADR-014 §3).

**Embeddings are stored as a little-endian `Float32Array` in a BLOB**, mapped back through
`new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4)`. The `byteOffset` argument
is load-bearing: Node pools small Buffers, so a Buffer's `.buffer` is usually a *slice* of a
larger ArrayBuffer and dropping the offset silently reads another row's bytes. No recall path
consumes the embedding today (ADR-014 §2).

**`tags` round-trips through `JSON.stringify`/`JSON.parse`.** The column default is `'[]'`,
never `NULL`, so the parse never needs a null guard.

## Do not change without reading this

- **Do not make any method `async`.** The synchronous API *is* the ADR-001 decision: async
  adds 15–30ms per query and breaks the <50ms recall contract. A promise in this file
  invalidates ADR-001.
- **Do not add a `LIKE` filter "just for now".** Each one multiplies the scan. If a new
  predicate is needed, add the index in the same commit.
- **Do not "simplify"** `new Float32Array(row.embedding.buffer, row.embedding.byteOffset, …)`
  to `new Float32Array(row.embedding.buffer)`. It passes every test with one memory in the
  database and corrupts vectors under load.
- **Do not claim the <50ms-at-10k-memories NFR from this implementation.** It has never been
  benchmarked; `docs/spec.md` marks it `unrun` until a record exists under `docs/evidence/`.

## Verification

- `tests/unit/adapters/sqlite-memory-repository.test.ts` — runs against a real `:memory:`
  SQLite database, never a mock (the repository contract *is* the SQL).
- Missing: a benchmark at 10k rows, and a test pinning the `byteOffset` behaviour with a
  pooled Buffer. Both tracked in `docs/gs-assessment.md`.
- **Environment note:** these tests require a `better-sqlite3` prebuild matching the running
  Node ABI. See the first Known Pitfall in `.claude/ledger.md`.
