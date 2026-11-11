---
id: ADR-028
type: adr
status: active
tier: T1
properties: [verifiable, defended, auditable]
obligations: 8
depends_on: [ADR-027, ADR-017, ADR-019]
---

# ADR-028: A de-duplication threshold belongs to the gateway that produced the vectors

**Date:** 2026-11-10
**Status:** Accepted 2026-11-10 — "hagamos las dos cosas"
**Amends:** ADR-027 §3, which deliberately left the thresholds alone and recorded the choice as
open. Both of ADR-027's open questions are answered here. ADR-027's other sections stand.

## Context

ADR-027 §3 reported that de-duplication had never once fired on a duplicate: the shipped
thresholds sat above the maximum similarity any genuine duplicate reached — Jaccard 0.50 against
a maximum of 0.313, cosine 0.83 against 0.534 — so F1 was 0.00, and its only two positives in the
corpus were *contradictions*. It left two things open because both change what somebody receives:
whether to lower the thresholds, and whether a real embedding model is worth having.

Taking the obvious action would have been a serious regression, and the measurement that showed
why is the substance of this record.

### The pairwise best threshold is catastrophic in service

`pairs.ts` measures a pairwise question: are these two memories the same knowledge? Every method's
F1 peaks at a low threshold there — 0.10 for both lexical methods, 0.65 for the model.
`TeamPromotionService.promote` asks something different: is this candidate already covered by the
pool? It answers with the **maximum** similarity over the whole pool, and a maximum over N draws
grows with N.

Measured against the 51-memory fixture, with 11 duplicate candidates reusing the labels already in
`pairs.ts` and 12 novel candidates whose subject is absent from it:

| configuration | duplicates suppressed (of 11) | **novel memories wrongly suppressed (of 12)** |
|---|---|---|
| vector + guard @ 0.10 — the pairwise best | 11 | **11** |
| model + guard @ 0.55 | 11 | **12** |
| model + guard @ 0.60 | 11 | **9** |

Each of those is a memory the team would never receive, with nothing in any log to show it.
Applying the pairwise optimum would have converted a feature that did nothing into one that
silently withheld almost everything — the one failure mode nobody observes.

### The shipped 0.83 was approximately right, for a gateway that was missing

The same measurement, at the safe end of each curve:

| configuration | threshold | duplicates suppressed | novel wrongly suppressed |
|---|---|---|---|
| lexical (Jaccard) + guard | 0.20 | 6 | 0 |
| vector + guard | 0.25 | 6 | 0 |
| model + guard | 0.75 | **7** | 0 |
| model + guard | 0.83 — *as shipped* | 6 | 0 |

So `SEMANTIC_SIMILARITY_THRESHOLD = 0.83` was never a badly chosen number. It was chosen for a
sentence-transformer, and against one it suppresses 6 of 11 duplicates and loses nothing. It was
inert because **the gateway it was written for was not installed** — `server.ts` handed the
service a `FastEmbedGateway` alone, which is unavailable by default, so the service fell through
to Jaccard at 0.50 and the 0.83 never ran at all. The defect was the wiring, and ADR-027 §3 fixed
that part; what remains is that one constant cannot serve two incomparable vector spaces.

### A real model does close the paraphrase gap

ADR-027's second open question, now measured. `fastembed` 3.0.0 as a **devDependency**
(`chore(deps)`, with the audit evidence) supplies BGE-small-en-v1.5, and `cosine(dialog, modal)`
is **0.7108** where the in-tree lexical space gives approximately zero.

Over the 35 labelled recall queries:

| configuration | MRR | R@5 | paraphrase MRR | mean ms / query |
|---|---|---|---|---|
| `shipped` — lexical scoring | 0.76 | 0.83 | 0.42 | 0.35 |
| `semantic` — in-tree vectors | 0.73 | 0.72 | 0.30 | 0.71 |
| `semantic-model` | **0.86** | 0.85 | **0.75** | **168** |
| `hybrid-model` | 0.86 | **0.88** | 0.74 | **142** |

The paraphrase class goes 0.42 → 0.75. That is the question ADR-027 could not answer, answered:
yes, a model closes most of the gap the hashed lexical vectors do not.

And it costs **~150ms per query against NFR-03's 50ms budget** — three times over, measured over a
51-memory store. The cost is one query embedding, so it does not grow with the store; at 10,000
memories the lexical path is p95 16.93ms and the model would add that ~150ms flat.

## Decision

### 1. The threshold is a property of the gateway, not a constant in the service

`EmbeddingGateway` gains an optional `dedupThreshold`. Each gateway declares the operating point
measured for **its own** vector space:

| gateway | `dedupThreshold` | why that value |
|---|---|---|
| `LexicalVectorGateway` | **0.25** | lowest sweep step losing no novel memory, with one step of margin |
| `FastEmbedGateway` | **0.75** | same rule; catches 7 of 11 against 6 at the old 0.83 |
| `FirstAvailableEmbeddingGateway` | delegates to whichever it chose | the scale follows the space |

The service reads `embeddings.dedupThreshold` and falls back to the old constant when a gateway
does not declare one, so a third-party gateway keeps working. `PROMOTE_SIMILARITY_THRESHOLD`
(the Jaccard fallback) goes **0.50 → 0.20**, which doubles what it catches — 3 of 11 to 6 of 11 —
at no measured cost.

**The selection rule is written down because the numbers will need re-deriving.** Take the
pool-scale sweep, find the lowest threshold at which *no* novel memory is suppressed, and keep one
sweep step of margin above the first value that loses one. Not the best F1: the two errors are not
symmetric. A false negative leaves a near-duplicate in the pool, which somebody can see and
delete; a false positive withholds a memory, which nobody can see at all.

### 2. The model is adopted for de-duplication and NOT for recall

- **De-duplication:** already reaches it through `FirstAvailableEmbeddingGateway` (ADR-027 §3).
  With §1 it now also uses the right threshold for it. A user who installs `fastembed` gets a
  better de-duplicator and needs to do nothing else.
- **Recall:** not adopted. 150ms per query is 3× NFR-03, and recall runs at the start of every
  substantive block — this is the path whose latency the whole storage decision (ADR-001) was made
  to protect. The quality is real and so is the cost, and the budget is the published contract.
- **What would change that:** an async recall path behind explicit configuration, for a user who
  states they prefer 0.86 MRR at 150ms over 0.76 at 0.3ms. That is a feature with an NFR
  consequence, not a default, and it is not built.

### 3. `fastembed` stays a devDependency

Measured rather than assumed, because ADR-003 once accepted a risk against the wrong facts:
`pnpm audit --prod --audit-level=high` is unchanged at exit 0, `pnpm why fastembed --prod` returns
nothing, and **no advisory at moderate or above has a path through `fastembed` or
`onnxruntime-node`**. ADR-003's nine `tar` advisories came from `fastembed@1`; version 3 brings
none.

That weakens the supply-chain half of ADR-017's reasoning, and this record says so rather than
letting a future reader cite it unchanged. It does **not** reverse ADR-017: the ~130MB model
download against UC-008's zero-config cold start is a separate objection and it still holds, as
does the finding that `optionalDependencies` does not mean "not installed".

## Alternatives Considered

**Lower the thresholds to the pairwise best F1.** Rejected on measurement — 11 of 12 novel
memories suppressed. This was the obvious action and it is the reason the pool-scale experiment was
built before the change rather than after it.

**One threshold per *method* rather than per gateway.** Rejected: the service does not know which
method it used until the gateway answers, and "semantic" is not one scale. Two gateways both
returning cosines is exactly the case a single constant gets wrong.

**Make the threshold configurable in `~/.chronicle/config.json`.** Rejected for now. It is a
number nobody can choose without running this experiment, and a user who sets it badly loses
memories silently. The gateway's measured default is the better answer until somebody has a reason
the measurement does not cover.

**Make de-duplication advisory — report the near-duplicate and let the caller decide.** Not
rejected, and arguably better than any threshold: it converts an invisible failure into a visible
one. It changes the `promote` tool's contract and result shape, so it belongs in its own record.

**Adopt the model for recall too.** Rejected on NFR-03, above.

## Consequences

- **De-duplication works for the first time.** 6 of 11 labelled duplicates suppressed with the
  default gateway, 7 of 11 with a model, and zero novel memories lost in either case.
- A gateway now carries its own operating point, so adding a third vector space is a change in one
  file rather than a hunt for every constant that assumed the old scale.
- **The model path is measured and documented but not on by default anywhere a latency budget
  applies.** Recall keeps its 0.3ms path; de-duplication, which runs at promote time and has no
  NFR, takes the better vectors when they exist.
- `pnpm run experiments` now has a model section that is skipped with a reason when `fastembed` is
  absent, so the reproducible-anywhere property survives.
- One more number has an owner: `experiments/baseline-dedup.json` fails a run when best-achievable
  F1 drops, and the pool-scale rows are in `docs/evidence/dedup-experiment.json`.

## Verification

- `docs/evidence/dedup-experiment.json` — the pairwise tables, the full threshold sweep, the
  pool-scale rows and the pool-size sensitivity, regenerated by `pnpm run experiment:dedup`.
- `docs/evidence/recall-experiment.json` — the model configurations and their floor sweep. The
  model floor (0.65) was fixed **before** reading any per-case result and the sweep's best is not
  folded into the headline; MRR is flat at 0.86 from 0.40 to 0.65, so the a-priori choice cost
  nothing, which is only knowable because the curve is printed.
- **Pool-size sensitivity.** At the three chosen thresholds, novel suppressions stay at **zero**
  across pool sizes 10, 25 and 51. A 5× range with no drift.
- **Not verified, and the limit that matters most:** behaviour at a pool of thousands. The
  quantity being compared is a maximum over the pool, so the safe threshold can only move upward
  as the pool grows. These values are therefore *lower bounds* measured on 51 memories, and the
  selection rule above is recorded precisely so they can be re-derived rather than guessed at.
- **Not verified:** that the guard's cost is acceptable. It blocks 3 of 11 genuine duplicates
  because it reads the whole memory, so a negation inside a rationale counts as if it negated the
  claim. A sharper guard would raise every number in §1 and none of this measures one.
