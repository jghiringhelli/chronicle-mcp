---
id: EDR-006
type: edr
status: active
tier: T2
properties: [verifiable, auditable, executable]
obligations: 7
depends_on: [ADR-027, ADR-014, ADR-018]
---

# EDR-006: Recall ranking — candidate selection, lexical scoring, optional vectors

**Governs:** `src/services/recall-ranker.ts`, `src/shared/text.ts`,
`src/infrastructure/gateways/lexical-vector-gateway.ts`,
`src/services/memory-service.ts` (the `recall` method),
`src/adapters/repositories/sqlite-memory-repository.ts` (the `recall` method)
**Derives from:** ADR-027 (recall is scored; the vector path is available, not default),
ADR-014 §1–§2 (keyword-first, embeddings optional), ADR-018 §1 (scope filtering)

## Function — what this unit does

Answers *which memories answer this query, best first*, in two stages that live in two layers.

| Stage | Where | Decides | Does not decide |
|---|---|---|---|
| **candidates** | `SqliteMemoryRepository.recall` | eligibility — which rows may be returned at all | relevance order |
| **ranking** | `MemoryService.recall` | order, and the cut to `limit` | eligibility |

**Contract**

- A query with text but **no content words** returns nothing. `"what is the capital of France"`
  has no content words after stop-word removal, so the honest answer is the empty list.
- An **empty** query is not that case. It means "no text filter" — `session start` and the
  distillation both rely on it — and returns everything in scope in weight order. Collapsing the
  two states would make both callers return nothing.
- The ranking MUST consult the query. Weight may break a tie between equally relevant memories
  and MUST NOT be able to overturn a difference in coverage.
- The `limit` MUST be applied **after** ranking. Truncating in SQL by weight discards the best
  match before anything has scored it, and no ranker recovers it afterwards.
- Ranking is synchronous and requires no `EmbeddingGateway`. Absence of a gateway changes
  nothing about the default path (ADR-014 §2).
- The three callers of `tokenize` — SQL filter, scorer, vectoriser — MUST agree. They share one
  implementation for that reason.

## Implementation — what is load-bearing

**One tokenizer in `shared/`, not three.** The SQL filter is an adapter, the scorer is a service
and the vectoriser is infrastructure; none of the three layers may import the others, so the
shared leaf is the only place all three can reach. If two disagreed about what a word is, a
memory could pass the filter and then score zero, or score well and never be retrieved — a
failure that presents as "recall sometimes misses things" and is close to undebuggable from
outside. `TeamPromotionService` keeps a **fourth**, different tokenizer (minimum length three, no
stop-word removal) because its Jaccard de-duplication is a separate measured decision; that
divergence is deliberate and `experiments/dedup` measures it.

**Coverage, not match count.** `lexicalScore` is the fraction of the query's content words
present in the memory, plus a phrase bonus and a tag bonus. A raw count would reward a long
memory for containing more words, which is the opposite of useful in a list a model must read
inside a budget.

**No IDF.** Inverse document frequency needs corpus statistics, which would make a memory's rank
depend on what else is in the store and when the statistics were computed. A ranking that shifts
under an unrelated write is not something a user can reason about, and the stop-word list already
removes most of what IDF would discount.

**`WEIGHT_TIEBREAK = 0.05`.** Small enough that it cannot overturn a coverage difference,
large enough to order two equally relevant memories by durability. The defect this unit replaces
is exactly what happens when weight is allowed to act as relevance.

**`CANDIDATE_MULTIPLIER = 10`.** The SQL `LIMIT` runs before any scoring, so the service asks for
ten rows per result wanted. At the default limit that is 200 rows of string work — a fraction of
a millisecond, well inside NFR-03.

**Signed hashing in the vector gateway.** A feature's sign comes from bit 31 of its hash, so
colliding features cancel as often as they reinforce. With unsigned hashing collisions only add,
and similarity drifts upward as the vocabulary grows.

**Character 4-grams are down-weighted to 0.35** against a whole token's 1.0. At equal weight
`migration` and `migraine` become near-neighbours on shared substrings, trading the morphology
win for a precision loss.

**The vector path is not the default ranker**, and the reason is measured rather than assumed:
it wins on morphological near-misses (MRR 1.00 against 0.80), loses on paraphrase (0.30 against
0.42), and gives unrelated text a small non-zero similarity — which costs the false-positive
property the lexical path has for free, since coverage of zero is zero rather than "slightly
similar". No cosine floor recovers both: at 0.15 the false positives vanish and MRR falls from
0.73 to 0.67. See ADR-027 for the decision and `docs/evidence/recall-experiment.json` for the
numbers.

## Verification

- **Measured 2026-11-10** over 51 memories and 35 hand-labelled queries
  (`experiments/recall`, method copied from CodeSeeker's `tests/relevance/`):

  | configuration | MRR | R@5 | cases passed | out-of-scope answered |
  |---|---|---|---|---|
  | `keyword-legacy` (as shipped before) | 0.26 | 0.42 | 9/35 | 2/3 |
  | `shipped` (this unit) | **0.76** | **0.83** | **27/35** | **0/3** |
  | `semantic` (vectors only) | 0.73 | 0.72 | 22/35 | 3/3 |
  | `hybrid` (rank fusion) | 0.80 | 0.79 | 24/35 | 3/3 |

  `shipped` is measured **through `MemoryService.recall`**, not through a reimplementation, so the
  row cannot claim an improvement the shipped code does not have. `keyword-legacy` is a frozen
  copy of the pre-change SQL and reproduces the originally recorded 0.2643 / 0.4219 to four
  decimals, which is what makes the before/after comparison checkable rather than remembered.
- **Verified by test.** `recall-ranker.test.ts` pins that weight breaks a tie and cannot overturn
  coverage — the regression test for the replaced defect. `memory-service.test.ts` pins that the
  limit is applied after ranking and that an empty query still returns everything in scope.
  `sqlite-memory-repository.test.ts` pins that a stop-word-only query returns nothing while an
  empty one does not. All were written red and failed before the change.
- **Verified by test, including the limits.** `lexical-vector-gateway.test.ts` asserts what the
  space does **not** capture — `dialog` against `modal` below 0.2 — because that limitation is the
  published justification for the vector path not being the default, and a change that quietly
  altered it would invalidate the report without failing anything.
- **Verified against the storage round trip.** The vector survives the float32 truncation the
  `embedding` column imposes at cosine > 0.9999, and the experiment reads its vectors back out of
  the column rather than holding them in memory.
- **Not verified: that a real embedding model would do better.** The three query classes that
  need synonymy — `syn-rollback-fast`, `para-customer-data-logs`, `para-noisy-alerts` — fail in
  **every** configuration measured here. A sentence-transformer is the obvious candidate and
  `FirstAvailableEmbeddingGateway` is the seam for it, but no model was measured, so the claim
  "embeddings would fix paraphrase" is unsupported by this work.
- **Verified at scale, for latency.** `pnpm run bench` with the new ranking in place:
  **NFR-03 p95 16.93ms at 10,000 memories** against a 50ms budget (median 6.71ms, max 22.12ms),
  inside the 14–23ms band recorded for the old ranking on this host. The scoring stage costs
  nothing measurable: it tokenises ~200 candidates per call, which is a fraction of the `LIKE`
  scan it rides on. NFR-02 cold start measured 326.67ms against its 300ms budget on the same run
  — a **pre-existing** miss, unrelated to this unit: cold start is Node plus the MCP SDK import
  (`.claude/ledger.md`, 2026-09-12), and this host's historical spread for it is 225–398ms.
- **Not verified: recall QUALITY at scale.** The labelled corpus is 51 memories. Latency at 10k is
  measured above; whether MRR holds when there are ten thousand candidates rather than fifty is
  not, and more memories means more plausible-but-wrong neighbours. A larger labelled corpus is
  the only instrument for that and none exists.
