---
id: ADR-027
type: adr
status: active
tier: T1
properties: [verifiable, auditable, executable]
obligations: 7
depends_on: [ADR-014, ADR-017, ADR-001]
---

# ADR-027: Recall is scored against the query; the vector path ships available, not default

**Date:** 2026-11-10
**Status:** Accepted 2026-11-10
**Amends:** ADR-014 §3 (FTS5 as the planned replacement) and §4 (no prose may claim vector recall).
ADR-014 §1 (keyword-first, dependency-free) and §2 (an absent gateway is never an error) stand
unchanged and are strengthened here.

## Context

ADR-014 recorded, honestly, that the `embedding` column and the `EmbeddingGateway` port were
carried with no recall consumer, and wrote down the risk in its own Consequences: *"they are the
kind of unused surface that becomes ghost code if §3 slips."* §3 slipped for two months. Reviewers
reading the project to assess it raised two objections, and both were correct: the embeddings do
nothing, and there was no experiment that could have told anyone whether they would.

Measuring it first turned up something ADR-014 does not say. **The ranking never consulted the
query at all.** `SqliteMemoryRepository.recall` filtered with `content LIKE` and ordered by
`weight DESC`, returning `row.weight` as the "relevance score", and truncated in SQL — so a memory
matching one of five query words outranked one matching all five whenever it weighed more, and the
`limit` discarded the best match before anything had scored it. Separately, word conditions were
OR-ed with no stop-word handling, so `"what is the capital of France"` matched almost every row
through `is` and `of`.

So the gap was never only the missing vectors. Measured over 51 memories and 35 hand-labelled
queries, the shipped path scored **MRR 0.26, R@5 0.42**, passing 9 of 35 cases and answering 2 of
3 queries that nothing in the store could answer.

## Decision

### 1. Recall is scored against the query, in two stages

Candidate selection stays in the adapter and decides **eligibility**; ranking moves to
`MemoryService.recall` and decides **order**. Weight becomes a tiebreaker with a coefficient small
enough that it cannot overturn a difference in coverage. The `limit` is applied after ranking.
A query with text but no content words returns nothing; an **empty** query still means "no text
filter", because `session start` and the distillation depend on it.

This is the whole of the default path, it is synchronous, and it requires no embedding gateway —
so ADR-014 §1 and §2 hold exactly as written.

### 2. A dependency-free vector path ships, and is not the default ranker

`LexicalVectorGateway` gives every install a working vector space — hashed word, bigram and
character-4-gram features, L2-normalised, deterministic, **no new dependency and no model
download**, so ADR-017's supply-chain refusal does not recur and UC-008's zero-config cold start
is preserved. It is named for what it is: not a neural embedding, and it does not capture synonymy.

It is **not** the default ranker, and the reason is measured:

| configuration | MRR | R@5 | cases passed | out-of-scope answered |
|---|---|---|---|---|
| `keyword-legacy` (as shipped before) | 0.26 | 0.42 | 9/35 | 2/3 |
| `shipped` (§1) | **0.76** | **0.83** | **27/35** | **0/3** |
| `semantic` (vectors only) | 0.73 | 0.72 | 22/35 | 3/3 |
| `hybrid` (rank fusion) | 0.80 | 0.79 | 24/35 | 3/3 |

`hybrid` wins MRR by 0.04 and loses on R@5, on cases passed, on false positives, and at four times
the latency. The false-positive column is the decisive one: the lexical path gets it for free,
because coverage of zero *is* zero, while a vector space gives unrelated text a small non-zero
similarity. No cosine floor recovers both halves — at 0.15 the false positives vanish and MRR
falls from 0.73 to 0.67, and at 0.30 MRR collapses to 0.28.

**Most of the improvement was never about embeddings.** Scoring the same candidate set, with no
vectors involved, moved MRR from 0.26 to 0.76. The vector path adds morphology — `rotating` finds
`rotate`, MRR 1.00 against 0.80 — and subtracts paraphrase, 0.30 against 0.42. Saying otherwise
would have been the most flattering available reading of this data.

### 3. De-duplication switches to the vector path and gains a contradiction guard

Measured over 32 hand-labelled pairs, **de-duplication did not de-duplicate**. The shipped
thresholds are above the maximum similarity any genuine duplicate reaches — Jaccard 0.50 against a
maximum of 0.313, cosine 0.83 against 0.534 — so F1 was **0.00** for both methods. Worse, the two
most similar pairs in the entire corpus were *contradictions*: "bodies are never logged" against
"bodies are logged at debug" scored 0.667 by Jaccard. At the shipped threshold the only two things
de-duplication ever did were merge those two contradictions, silently withholding from the team a
memory that reversed a policy.

So: `FirstAvailableEmbeddingGateway` prefers `fastembed` when the user installed it and falls back
to `LexicalVectorGateway`, which fixes the default without deleting the upgrade ADR-017 promised;
and `negationMismatch` blocks a merge whenever one memory negates and the other does not. At each
method's best threshold:

| method | precision | recall | F1 | contradictions merged |
|---|---|---|---|---|
| lexical (Jaccard) | 0.57 | 0.73 | 0.64 | 5 of 5 |
| semantic (cosine) | 0.63 | 0.91 | 0.74 | 5 of 5 |
| semantic + guard | **0.89** | 0.73 | **0.80** | **1 of 5** |

The guard is strictly safety-improving: it can only prevent a merge, never cause one. It costs
three genuine duplicates of eleven, because it reads the whole memory and a negation inside a
*rationale* counts as if it negated the claim.

**The thresholds are left as they are, deliberately.** Lowering them is what would make
de-duplication function, and it is a product decision about what gets withheld from a teammate
rather than a correctness fix — so it is recorded here as the open question and not taken
unilaterally.

### 4. The claim in prose is exactly what the instruments measured

ADR-014 §4 forbade claiming vector recall because there was none. There is now a vector path, so
the rule becomes stricter rather than obsolete: **`README.md`, `docs/spec.md` and `Status.md` state
the measured numbers and name the query classes that still fail.** No document may describe the
vector path as semantic understanding; three labelled queries that genuinely require synonymy fail
in *every* configuration measured.

### 5. FTS5 is no longer the plan

ADR-014 §3 named FTS5 the planned replacement for `LIKE`. It is not scheduled. FTS5 would improve
candidate *retrieval*; the measured defect was candidate *ranking*, and the retrieval scan is
p95 16.93ms at 10,000 memories — a tenth of a 50ms budget. FTS5 becomes worth doing when the scan
is the bottleneck, which it is not, and this section exists so the next reader does not implement
it believing a record told them to.

## Alternatives Considered

**Make `hybrid` the default.** Rejected on its own numbers: +0.04 MRR against −0.04 R@5, three
fewer cases passed, three out-of-scope queries answered instead of zero, and four times the
latency. The MRR win is real and is not worth the precision.

**Install a sentence-transformer and make recall genuinely semantic.** Not rejected —
**unmeasured**, which is a different thing. `fastembed` carries nine advisories including a
critical (ADR-017) and downloads a ~130MB model on first use, which breaks the zero-config
contract and the experiment's "no network" reproducibility. The honest position is that the three
query classes needing synonymy fail in every configuration measured here, a model is the obvious
candidate, `FirstAvailableEmbeddingGateway` is the seam, and nobody has yet shown it helps on this
corpus. Running it as a dev-only dependency behind a flag is the next experiment.

**Leave recall alone and only add vectors.** Rejected, and it was the original plan. Adding
vectors to an unranked path would have produced a real improvement for entirely the wrong reason,
and the write-up would have credited embeddings with a scoring fix. The diagnostic configuration
exists in the harness specifically so that mistake is visible rather than available.

**Delete the `embedding` column and the gateway port.** Rejected. The column now has its first
consumer, written at `remember` time and read at recall, and de-duplication depends on the port.

## Consequences

- Default recall is materially better on every axis measured, with no new dependency, no model, no
  network and no configuration: MRR 0.26 → 0.76, R@5 0.42 → 0.83, cases passed 9/35 → 27/35, and
  out-of-scope queries answered 2/3 → 0/3.
- **An existing store benefits immediately.** Ranking reads content, not vectors, so nothing needs
  a backfill. A row with no stored vector is embedded on the spot if the vector path is used.
- The `embedding` column stops being ghost code, which is what ADR-014 feared it would become.
- `experiments/` is now a committed, reproducible instrument, and `experiments/baseline-recall.json`
  makes a future regression fail a run instead of being noticed in use. The ratchet applies to
  recall quality from here.
- **De-duplication still does not de-duplicate.** The guard removes the harm; the thresholds remain
  inert by measurement and that is now a recorded open decision rather than an unknown.
- A fourth tokenizer survives in `TeamPromotionService`, differing on purpose (minimum length
  three, no stop-word removal). Three were unified; this one is measured separately.

## Verification

- `docs/evidence/recall-experiment.json` and `docs/evidence/dedup-experiment.json`, regenerated by
  `pnpm run experiments` on any machine. No credentials, no network, no model; each run builds its
  own database under the OS temp directory and deletes it.
- The `shipped` row is measured **through `MemoryService.recall`**, so it cannot report an
  improvement the product does not have. `keyword-legacy` is a frozen copy of the pre-change SQL
  and reproduces the originally recorded 0.2643 / 0.4219 to four decimals, which is what makes the
  before/after comparison checkable instead of remembered.
- 406 tests pass, 24 of them new on these units, and the behaviour tests were written red: ranking
  by relevance, the limit after ranking, and the stop-word-only query each failed before the change.
- **The corpus was committed before the ranker existed** (`863ebe1`), so it cannot have been tuned
  to it. `experiments/README.md` § Provenance states the constraint and its limits: one labeller,
  synthetic memories, 51 of them.
- **Open, and not verified by anything here:** whether a real embedding model closes the paraphrase
  gap; whether MRR holds at ten thousand memories; and whether lowering the de-duplication
  thresholds is the right trade.
