# Does Chronicle find the right memory? — a measured answer

**Date:** 2026-11-10
**Repository:** `chronicle` (`github.com/jghiringhelli/chronicle-mcp`), branch `pilot/companion-2026-10`
**Artefacts:** `docs/evidence/recall-experiment.json`, `docs/evidence/dedup-experiment.json`
**Reproduce:** `pnpm run experiments` — no credentials, no network, no model download
**Decisions:** ADR-027, EDR-006

---

## Why this exists

Two objections came from people reading the project to assess it, and both were correct:

1. **The embeddings do nothing.** The `embedding` column was written and never read by any recall
   path. ADR-014 had said so in writing two months earlier, and had predicted this exact outcome:
   *"they are the kind of unused surface that becomes ghost code if §3 slips."* §3 slipped.
2. **There was no experiment.** Latency was benchmarked. Quality — whether recall returns the
   memory you asked for — had never been measured, so "semantic memory" was a claim with no
   instrument behind it.

The instruction was to add the embeddings and **measure first**. That ordering turned out to matter
more than expected, because measuring first is what revealed that the embeddings were the smaller
of the two problems.

## The short version

| | before | after |
|---|---|---|
| MRR | 0.26 | **0.76** |
| recall@5 | 0.42 | **0.83** |
| labelled cases passed | 9 / 35 | **27 / 35** |
| queries answered that nothing could answer | 2 / 3 | **0 / 3** |

And the finding that matters most for how this gets described:

> **Almost none of that improvement is the embeddings.** Scoring the candidate set against the
> query, with no vectors involved at all, accounts for the whole move from 0.26 to 0.76. The vector
> path adds one query class and subtracts another, and is not the default ranker.

De-duplication was measured too, and came out worse than recall did:

> **At the thresholds it shipped with, de-duplication detected zero duplicates — F1 0.00 — while
> its only two positives in the whole corpus were contradictions.** It had never prevented a
> duplicate, and the one thing it did do was withhold from a teammate a memory that reversed a
> policy.

---

## Method

Copied from CodeSeeker's `tests/relevance/`, deliberately, so a Chronicle number and a CodeSeeker
number can be set side by side and the comparison means something: a hand-labelled corpus, the
actual rank of every target recorded per (query × configuration), the same five metrics with the
same arithmetic — MRR, P@1, P@3, R@5, F1@3 — and a committed baseline with a regression threshold.

**51 memories, 35 labelled queries, 7 query classes.** Both are adversarial on purpose. Eight
memories mention `retry` and five mention `queue`, so distractors share vocabulary with the
queries; and the weights are set so that relevance and weight *disagree* — some exact-match
targets carry the lowest weights in the fixture while irrelevant distractors carry the highest. A
corpus without that scores 1.00 on every configuration and measures nothing.

Two departures from CodeSeeker's version, because the subject is a memory store and not a codebase:

- Targets are memory **ids**, not filename substrings. A memory has no path.
- There is an **out-of-scope class**: three queries nothing in the store can answer. Code search
  always has some nearest file; a memory store legitimately holds nothing about Bluetooth, and
  answering anyway is how an assistant comes to cite a memory that does not apply. Those cases are
  excluded from the five metrics — a constant 0 added to every configuration's MRR moves every
  number equally and informs nobody — and reported separately as a false-positive count.

### Provenance

The experiment and the thing it measures were written by the same person, which is the standard way
a benchmark comes to flatter its subject. Three constraints stand against that, and all three are
checkable:

1. **The corpus was committed before the ranker existed.** The fixture, the labelled queries, the
   metrics and the red baseline landed in `863ebe1`, with the three remaining configurations
   printing *why they did not run* rather than vanishing from the table. The ranker and the vector
   gateway landed in later commits. `git log` is the evidence, and the work was sequenced that way
   for this reason rather than built in one pass.
2. **The pre-change path is frozen, not re-pointed.** `keyword-legacy` is a copy of the old SQL
   held inside the experiment. Calling the live code would have silently turned the before/after
   comparison into a comparison of the new code with itself. The copy reproduces the originally
   recorded **MRR 0.2643 / R@5 0.4219 to four decimals**, which is what makes it faithful rather
   than merely frozen.
3. **The shipped row is measured through the shipped code.** `shipped` calls
   `MemoryService.recall`, not a reimplementation, so it cannot report an improvement the product
   does not have.

---

## Result 1 — recall

| configuration | MRR | P@1 | P@3 | R@5 | F1@3 | cases | out-of-scope answered | mean ms |
|---|---|---|---|---|---|---|---|---|
| `keyword-legacy` — as shipped before | 0.26 | 0.16 | 0.11 | 0.42 | 0.17 | 9/35 | 2/3 | 0.07 |
| **`shipped`** — scored ranking | **0.76** | 0.72 | 0.29 | **0.83** | 0.41 | **27/35** | **0/3** | 0.26 |
| `semantic` — vectors only | 0.73 | 0.72 | 0.26 | 0.72 | 0.37 | 22/35 | 3/3 | 0.54 |
| `hybrid` — reciprocal rank fusion | **0.80** | 0.78 | 0.29 | 0.79 | 0.41 | 24/35 | 3/3 | 1.26 |

The `mean ms` column is one run over a 51-memory store, and these are sub-millisecond operations
whose relative spread between runs is wide — the hybrid figure read anywhere from 1.05 to 1.26
across the runs in this session. Read it as an order-of-magnitude comparison between
configurations, not as a latency measurement. The latency claim that means something is the NFR
benchmark at 10,000 memories, below.

### By query class — MRR / R@5

| class | n | keyword-legacy | shipped | semantic | hybrid |
|---|---|---|---|---|---|
| exact-keyword | 8 | 0.56 / 1.00 | 1.00 / 1.00 | 1.00 / 1.00 | 1.00 / 1.00 |
| morphology | 5 | 0.30 / 0.40 | 0.80 / 0.80 | **1.00 / 1.00** | **1.00 / 1.00** |
| paraphrase | 10 | 0.07 / 0.15 | **0.42 / 0.65** | 0.30 / 0.30 | 0.45 / 0.45 |
| synonym | 5 | 0.02 / 0.00 | 0.80 / 0.80 | 0.80 / 0.80 | 0.80 / 0.80 |
| ranking | 5 | 0.42 / 0.80 | 1.00 / 1.00 | 1.00 / 1.00 | 1.00 / 1.00 |
| multi-relevant | 5 | 0.27 / 0.30 | **0.67 / 0.70** | 0.50 / 0.40 | 0.64 / 0.65 |

### What the baseline's weakness actually was

The published record (ADR-014) described the limitation as lexical matching: *"a query phrased
differently from the stored memory misses"*. True, and not the whole defect. Reading the code to
build the experiment turned up three things the record does not mention:

1. **The ranking never consulted the query.** `recall()` filtered with `content LIKE`, ordered by
   `weight DESC` and returned `row.weight` as the "relevance score". A memory matching one of five
   query words outranked one matching all five whenever it weighed more.
2. **The `limit` was applied before anything scored.** Truncating in SQL by weight discarded the
   best match, and no ranker recovers it afterwards.
3. **Word conditions were OR-ed with no stop-word handling.** `"what is the capital of France"`
   matched almost every memory in the store through `is` and `of`. Two of three out-of-scope
   queries came back with a full page of results.

That is why the fix is mostly not about embeddings — and why the experiment carries a diagnostic
configuration that isolates scoring from vectors. Without it, the honest attribution would not have
been available, and "we added embeddings and MRR tripled" would have been true, cheap and
misleading.

---

## Result 2 — de-duplication

The question `TeamPromotionService` asks before pushing a memory to the shared pool: *is this the
same knowledge the team already has?* 32 hand-labelled pairs, 11 duplicates and 21 not, most of the
negatives deliberately hard — memories that share most of their vocabulary and are different
knowledge.

### At the thresholds the product shipped with

| method | threshold | precision | recall | F1 | true positives | false positives |
|---|---|---|---|---|---|---|
| lexical (Jaccard) | 0.50 | 0.00 | 0.00 | **0.00** | 0 | **2, both contradictions** |
| semantic (cosine) | 0.83 | 0.00 | 0.00 | **0.00** | 0 | 0 |

The reason is arithmetic rather than tuning. **The highest similarity any genuine duplicate reaches
is 0.313 by Jaccard and 0.534 by cosine** — both below their own thresholds. No duplicate in the
corpus could ever have fired either rule.

Meanwhile the two most similar pairs in the entire corpus are *contradictions*:

| pair | Jaccard | cosine |
|---|---|---|
| "bodies are never logged" / "bodies are logged at debug" | **0.667** | **0.726** |
| "I avoid mocks, prefer a fake" / "I prefer mocks, avoid fakes" | **0.556** | 0.616 |

A negation is one token, so reversing a statement's meaning barely moves a bag-of-words similarity.
The ordering is inverted at the top: any threshold high enough to look safe fires on contradictions
and nothing else. Which is what happened — the only two things de-duplication ever did were merge
those two pairs, silently withholding a memory that reversed a policy. That is the most expensive
error available here, because nobody observes a memory that was never shared.

### At each method's own best threshold — the fair comparison

Comparing two methods at two hand-picked operating points measures the constants as much as the
methods, so the sweep is the primary result.

| method | threshold | precision | recall | F1 | contradictions merged |
|---|---|---|---|---|---|
| lexical (Jaccard) | 0.10 | 0.57 | 0.73 | 0.64 | 5 of 5 |
| semantic (cosine) | 0.10 | 0.63 | **0.91** | 0.74 | 5 of 5 |
| semantic + negation guard | 0.10 | **0.89** | 0.73 | **0.80** | **1 of 5** |

**So semantic does beat lexical** — F1 0.74 against 0.64, recall 0.91 against 0.73 — which answers
the question that was asked. But neither method, at any threshold, can tell a contradiction from a
duplicate, so switching to semantic alone would have made the system merge *more* confidently in
exactly the cases where merging destroys information.

The guard (`negationMismatch`) blocks a merge when one memory negates and the other does not. It is
strictly safety-improving: it can only prevent a merge, never cause one, so its worst case is a
near-duplicate left in the pool for somebody to see and delete.

---

## What did not help

Reported because the reviewer asked for it, and because a study that only lists wins is not worth
reading.

- **The vector path is not better overall.** `semantic` loses to `shipped` on MRR (0.73 vs 0.76),
  on R@5 (0.72 vs 0.83), on cases passed (22 vs 27) and on false positives (3/3 vs 0/3), at
  roughly twice the per-query cost.
- **Vectors made paraphrase worse, not better.** 0.30 against 0.42 — the class embeddings were
  supposed to rescue. The hashed lexical space has no notion of synonymy, so on a query with no
  shared vocabulary it ranks on incidental character overlap, which is noise.
- **Vectors cost the false-positive property outright.** The lexical path answers 0 of 3
  unanswerable queries because coverage of zero *is* zero. A vector space gives unrelated text a
  small non-zero similarity, so it answers all three. The cosine floor sweep shows no setting
  recovers both halves:

  | cosine floor | MRR | R@5 | out-of-scope answered |
  |---|---|---|---|
  | 0.05 | 0.74 | 0.75 | 3/3 |
  | 0.10 | 0.73 | 0.72 | 3/3 |
  | 0.15 | 0.67 | 0.63 | 0/3 |
  | 0.20 | 0.59 | 0.55 | 0/3 |
  | 0.30 | 0.28 | 0.26 | 0/3 |

- **Hybrid's win is marginal and expensive.** +0.04 MRR, −0.04 R@5, three fewer cases passed, three
  false positives instead of zero, and four to five times the per-query cost. Rejected as the
  default on its own numbers.
- **The contradiction guard costs real duplicates.** Three of eleven — `dup-idempotency`,
  `dup-small-prs`, `dup-pipe-exit` — because it reads the whole memory, so a negation inside a
  *rationale* ("so a retry **cannot** bill twice") counts as if it negated the claim.
- **The guard misses the contradiction that carries no negation.** "I avoid mocks and prefer a
  fake" against "I prefer mocks and avoid fakes" reverses meaning by swapping two verbs. Neither
  sentence negates, so nothing is asymmetric. Catching it needs to parse the sentence rather than
  scan it, and that pair is asserted as a known miss in the tests.
- **My `synonym` class turned out not to isolate synonymy.** It scores 0.80 on three configurations
  because the targets share enough other vocabulary with the queries that coverage alone finds
  them. The genuinely synonym-dependent cases are scattered across the `paraphrase` class, which is
  where the remaining failures sit. The class names describe what I intended, not perfectly what
  they measure.
- **Three queries fail in every configuration measured.** `syn-rollback-fast`,
  `para-customer-data-logs` and `para-noisy-alerts` need actual synonymy — "getting back to the
  previous version" to find a memory about a warm blue-green rollback. Nothing here finds them.

---

## What changed in the product

- Recall became two stages: the adapter selects candidates, `MemoryService` ranks them. The `limit`
  is applied after ranking.
- Stop words are dropped from the candidate filter. A query whose words are all stop words returns
  nothing; an **empty** query still means "no text filter", because `session start` and the
  distillation depend on that.
- One tokenizer in `src/shared/text.ts`, replacing three that disagreed.
  `TeamPromotionService` keeps a fourth on purpose, and the dedup experiment measures it.
- `LexicalVectorGateway`: hashed word, bigram and character-4-gram features, L2-normalised,
  deterministic, **no new dependency and no model download**, so ADR-017's supply-chain refusal
  does not recur and the zero-config cold start survives. It is named for what it is.
- `FirstAvailableEmbeddingGateway` prefers `fastembed` when the user installed it and falls back to
  the in-process vectors. `server.ts` had handed the dedup service a `FastEmbedGateway` alone, which
  is unavailable on a default install — so every user fell through to the lexical path measured at
  precision 0.00.
- The `embedding` column has its first consumer, which ADR-014 feared it never would.
- `experiments/baseline-recall.json` and `baseline-dedup.json` make a later regression fail a run.
  That earned its keep immediately: three refactors later in the same session reported `+0.000` on
  every metric, which is how I know they were behaviour-preserving rather than hoping so.

**Latency.** NFR-03 re-measured with the ranking in place: **p95 16.93ms at 10,000 memories**
against a 50ms budget, inside the band recorded for the old ranking on this host. The scoring stage
costs nothing measurable.

**Two decisions deliberately not taken**, because both change what somebody receives and neither is
a correctness fix:

- **Lowering the de-duplication thresholds**, which is what would make it function. It changes what
  a teammate stops receiving.
- **Measuring a model-backed embedding path.** `fastembed` carries nine advisories including a
  critical and downloads a ~130MB model, which breaks both the zero-config contract and this
  experiment's no-network reproducibility. Running it as a dev-only dependency behind a flag is the
  next experiment, not a promise.

---

## What this does not establish

- **One labeller.** I wrote the queries and I decided which memories answer them. A second
  labeller, and an inter-annotator agreement figure, would be the obvious strengthening and neither
  exists.
- **Synthetic memories, 51 of them.** A real store has thousands and they are messier. Latency at
  10k is measured; **whether MRR holds at 10k is not**, and more memories means more
  plausible-but-wrong neighbours.
- **It measures ranking, not worth.** Whether the memory was worth storing is a different question,
  and the chronicle's actual output — the distilled profile and lessons — has no metric at all.
- **It cannot find a failure nobody wrote a query for.** Seven classes is a guess about how recall
  gets used.
- **The dedup experiment measures the decision function, not the service.** It scores the similarity
  functions directly rather than driving `promote`, because `promote` needs a configured Railway URL
  and writes to a database a partner reads. That the better function is wired in correctly is a
  unit test's job, not this one's.

---

## Reproducing it

```bash
pnpm install
pnpm run experiment:recall     # the table above, plus the cosine floor sweep
pnpm run experiment:dedup      # the dedup tables, plus the full F1 curve
pnpm run experiments           # both
```

Each run builds its own SQLite database under the OS temp directory and deletes it. Nothing reads
`~/.chronicle/chronicle.db`, nothing needs a credential, nothing touches the network, and no path in
the harness is absolute — it runs the same on Linux, macOS and Windows. Both runners write their
JSON to `docs/evidence/` on every run, including a failing one, and exit non-zero if a metric has
dropped more than 0.05 against the committed baseline.

Method, the labelling rationale per case, and the limits are in `experiments/README.md`.

## What can honestly be claimed from this

Stated precisely, because the point of the exercise was to have numbers rather than adjectives:

- Built a hand-labelled relevance benchmark for a memory-retrieval system — 51 memories, 35 queries,
  7 query classes, MRR / P@k / R@k / F1 — and used it to take recall from **MRR 0.26 to 0.76** and
  **recall@5 0.42 to 0.83**, with false positives on unanswerable queries going from 2/3 to 0/3.
- Found by measurement that a shipped de-duplication feature had **never once fired on a duplicate**
  — its thresholds sat above the maximum similarity any duplicate reached — and that its only
  positives were contradictions; then added a guard that cut false positives from 6 to 1.
- Did it with **no new runtime dependency**, no model download and no network, preserving a
  zero-config install contract and an existing supply-chain decision.
- **Reported that the headline improvement was not the feature everyone expected.** The embeddings
  contributed one query class and cost another; the scoring was the defect. The experiment carries a
  diagnostic configuration whose only purpose is to make that attribution impossible to get wrong.

The last one is the only item on this list that a reader cannot get from a changelog, and it is the
one worth leading with.
