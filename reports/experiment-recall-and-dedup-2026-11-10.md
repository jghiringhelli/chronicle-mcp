# Does Chronicle find the right memory? — a measured answer

**Date:** 2026-11-10, extended the same day with a real embedding model and a pool-scale
measurement after the two open questions below were taken rather than deferred
**Repository:** `chronicle` (`github.com/jghiringhelli/chronicle-mcp`), branch `pilot/companion-2026-10`
**Artefacts:** `docs/evidence/recall-experiment.json`, `docs/evidence/dedup-experiment.json`
**Reproduce:** `pnpm run experiments` — no credentials, no network, no model download
**Decisions:** ADR-027, ADR-028, EDR-006

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

Then both of the questions this report originally left open were taken, and the answers changed
two of its conclusions:

> **A real embedding model does close the paraphrase gap.** 0.42 → **0.75** on that query class,
> MRR 0.76 → **0.86** overall. It costs **140–170ms per query** against a published 50ms budget, so
> it is adopted for de-duplication, which has no budget, and refused for recall, which is the path
> the storage design exists to protect.

> **And the obvious way to fix de-duplication would have broken it.** The threshold that maximises
> pairwise F1 suppresses **11 of 12 novel memories** when applied the way the service applies it —
> as a maximum over the whole pool. Measuring that before changing anything is the only reason the
> fix is a fix.

Finally, the guard that makes any threshold safe was measured properly, and the first number this
report published about it was too kind to it:

> **The guard was reported as catching four of five contradictions. Against a corpus big enough to
> say anything, it caught 29 of 48.** The five hand-labelled pairs all happened to contain a
> negation, which was the only thing the guard could see. The 19 it missed reverse a decision by
> **swapping two alternatives** rather than negating one — and reading that construction takes it
> to **36 of 48** at no cost on any negative class. De-duplication now runs at F1 **0.63** by
> default and **0.78** with a model, from 0.00, with zero contradictions merged.

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

### With a real model

`fastembed` 3.0.0 as a devDependency supplies BGE-small-en-v1.5. The configurations are skipped
with a stated reason when it is absent, which is the default state, so the experiment stays
reproducible with no network.

| configuration | MRR | P@1 | R@5 | cases | out-of-scope answered | mean ms |
|---|---|---|---|---|---|---|
| `shipped` — lexical scoring | 0.76 | 0.72 | 0.83 | 27/35 | 0/3 | 0.3 |
| `semantic-model` | **0.86** | 0.81 | 0.85 | 27/35 | 1/3 | **169** |
| `hybrid-model` | 0.86 | 0.81 | **0.88** | 27/35 | 1/3 | **164** |

The model rows are dominated by one query embedding on CPU, which measured **140–170ms across
the runs in this session**. Unlike the sub-millisecond figures elsewhere in this report that is a
real latency: it is three to four times NFR-03's 50ms budget, and it is the reason the model is
refused for recall.

The floor was fixed at 0.65 **before** any per-case result was read, and the sweep's best is not
folded into the headline — choosing the floor that maximises MRR over the same 35 queries the MRR
is reported on is tuning on the evaluation set. As it happens MRR is flat at 0.86 from 0.40 to
0.65 and collapses to 0.47 by 0.75, so the a-priori choice cost nothing, which is only knowable
because the curve is printed.

A measurement bug worth naming, because it was mine and it flattered the result: the hybrid row
initially read **0.28ms**. It shared a query-vector cache with the model row and inherited it
warm. Each configuration now carries its own cache and pays its own inference.

### By query class — MRR / R@5

| class | n | keyword-legacy | shipped | semantic | hybrid | semantic-model | hybrid-model |
|---|---|---|---|---|---|---|---|
| exact-keyword | 8 | 0.56 / 1.00 | 1.00 / 1.00 | 1.00 / 1.00 | 1.00 / 1.00 | 0.94 / 1.00 | 0.94 / 1.00 |
| morphology | 5 | 0.30 / 0.40 | 0.80 / 0.80 | 1.00 / 1.00 | 1.00 / 1.00 | 1.00 / 1.00 | 1.00 / 1.00 |
| paraphrase | 10 | 0.07 / 0.15 | 0.42 / 0.65 | 0.30 / 0.30 | 0.45 / 0.45 | **0.75 / 0.75** | 0.74 / 0.75 |
| synonym | 5 | 0.02 / 0.00 | 0.80 / 0.80 | 0.80 / 0.80 | 0.80 / 0.80 | 0.80 / 0.80 | 0.80 / 0.80 |
| ranking | 5 | 0.42 / 0.80 | 1.00 / 1.00 | 1.00 / 1.00 | 1.00 / 1.00 | 0.90 / 1.00 | 0.90 / 1.00 |
| multi-relevant | 5 | 0.27 / 0.30 | 0.67 / 0.70 | 0.50 / 0.40 | 0.64 / 0.65 | 0.70 / 0.45 | 0.70 / 0.65 |

The paraphrase row is the whole story of the embeddings question. The in-tree hashed vectors took
it *down* from 0.42 to 0.30; the model takes it to 0.75. `cosine(dialog, modal)` is 0.7108 under
the model and approximately zero under the hashed features — synonymy is the thing a model has and
a bag of character n-grams cannot have.

Note what the model also loses: exact-keyword 1.00 → 0.94 and ranking 1.00 → 0.90. A model
ranks by meaning, so a query that names a rare token exactly can be beaten by a memory that is
*about* the subject. That is the argument for fusion rather than replacement, and `hybrid-model`
is the row with the best R@5 of anything measured.

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

### The decision the service actually makes

Everything above is a **pairwise** question. `promote` asks a different one — is this candidate
already covered by the pool? — and answers it with the **maximum** similarity over the whole pool.
A maximum over N draws grows with N, so the pairwise optimum is not an operating point.

Measured against the 51-memory fixture, with 11 duplicate candidates reusing the labels already in
`pairs.ts` and 12 novel candidates whose subject is absent from it:

| configuration | duplicates suppressed (of 11) | **novel memories wrongly suppressed (of 12)** |
|---|---|---|
| vector + guard @ 0.10 — *the pairwise best* | 11 | **11** |
| model + guard @ 0.55 | 11 | **12** |
| model + guard @ 0.60 | 11 | **9** |
| lexical (Jaccard) + guard @ 0.20 | 6 | **0** |
| vector + guard @ 0.25 | 6 | **0** |
| model + guard @ 0.75 | **7** | **0** |
| model + guard @ 0.83 — *the old constant* | 6 | **0** |

Every number in the right-hand column is a memory the team would never receive, with nothing in
any log. **Applying the pairwise best threshold — the obvious fix, and the one I was about to
make — would have turned a feature that did nothing into one that silently withheld almost
everything.**

Two things follow. First, the thresholds now belong to the gateway that produced the vectors,
because two gateways both returning cosines are not on one scale: 0.20 for Jaccard, 0.25 for the
in-tree vectors, 0.75 for the model. Second, **0.83 was never a bad number** — it was chosen for a
sentence-transformer, it is safe against one, and it was inert only because that gateway is absent
from a default install and the service fell through to Jaccard. The defect was the wiring.

At the thresholds the product now ships with:

| method | threshold | precision | recall | F1 | contradictions merged |
|---|---|---|---|---|---|
| lexical (Jaccard) — fallback | 0.20 | 0.55 | 0.55 | 0.55 | 5 |
| vector + guard — default | 0.25 | **1.00** | 0.45 | **0.63** | **0** |
| model + guard — when installed | 0.75 | **1.00** | 0.64 | **0.78** | **0** |

From 0.00, and both guarded configurations now merge **no** contradiction at all — precision 1.00
on the duplicate class. Still deliberately below the 0.84 achievable pairwise: that gap is the
price of not losing novel memories at pool scale, and it is the right way round to be wrong.

The unguarded model reaches F1 0.85, one point higher than the guarded 0.84 — and merges four
contradictions to get there. That one point is what the guard costs, and it is worth paying.

**Does the threshold hold as the pool grows?** At each chosen value, novel suppressions stay at
zero across pool sizes 10, 25 and 51. That is a 5× range with no drift — not a thousand memories,
and the section on what this does not establish says so. The thresholds were re-measured after
the guard was strengthened and did not move.

---

## Result 3 — the guard, and a number this report got wrong

Every row above with `+ guard` in it depends on a rule that decides whether two similar texts
**contradict** each other. An earlier version of this report said that rule caught *four of the
five* labelled contradictions. That figure was not wrong arithmetically; it was measured on a
sample far too small to support it, and it flattered the rule.

The rule was negation asymmetry: one text negates, the other does not. All five labelled pairs
happened to contain a negation, which is the only thing such a rule can see — so the corpus could
not have produced a bad score.

### A corpus that can produce a bad score

`experiments/dedup/polarity.ts` takes each of the **48** fixture memories that states a standing
decision and writes two texts against it:

- a **reversal** — the same subject, the opposite decision, with a reason for the change. Merging
  it with the original withholds a memory that reverses a policy.
- a **restatement** — the same decision in different words, keeping the original's rationale.
  Merging it is correct; blocking it costs a visible duplicate.

The two differ in exactly one respect, which is what makes the corpus measure the guard rather
than the similarity method under it. Both classes are necessary: a corpus of only contradictions
makes every guard look free, because a guard's errors are all false *blocks*.

| rule | reversals caught /48 | restatements blocked /48 | `opposite` pairs /5 | pool dups blocked /11 |
|---|---|---|---|---|
| negation only — *as published* | 29 | 9 | 4 | 4 |
| preference inversion only | 12 | **0** | 1 | **0** |
| **negation OR inversion — now shipped** | **36** | 9 | **5** | 4 |

**29 of 48, not 4 of 5.** The 19 misses reverse a decision by **swapping two alternatives** rather
than negating one — "rounded on each line item rather than once on the total" against "rounded
once on the total rather than on each line item". Nothing is negated; the preference is inverted,
and English marks that with a contrast construction.

Reading that construction adds **7** catches and costs **nothing**: restatements blocked, pool
duplicates and pairwise duplicates are all unchanged. It also catches the fifth labelled pair —
"avoid mocks, prefer a fake" against "prefer mocks, avoid fakes" — which the previous
implementation documented as the honest limit of the approach.

### The corpus reports on itself

If negations clustered in the reversals, "contains a negation" would *be* the label and the table
above would be measuring the corpus. They do not: **29 of 48** reversals and **23 of 48**
restatements contain one. That count is printed on every run rather than asserted once.

### Measured, dominant, and not adopted

Restricting the negation test to negations that bear on vocabulary the two texts share scores
**37/48** caught, 9 restatements, 5/5 opposites, and cuts the duplicate cost to **1/11** pool and
**0/11** pairwise. It is better on every column.

It is not shipped. It needs a window width and a shared-token floor, both chosen by reading this
corpus; the rule it replaces has no numeric parameter to overfit; and the entire gain is on the
**cheap** error. An in-sample win on the error that costs least is not a good enough reason to
add two fitted constants to a safety control. It is printed with every run as
`scoped(3,1)` and `scoped(4,2)` so a larger corpus can settle it.

### What is still missed

**12 of 48.** Reversals that substitute an antonym with no contrast marker and no negation —
"stored as integer cents" against "stored as floating point doubles". That needs lexical knowledge
the guard does not have, and the unit tests assert the miss so it cannot shift unnoticed.

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
- **The contradiction guard still costs real duplicates.** Three of eleven pairwise and four of
  eleven at pool scale — `dup-idempotency`, `dup-small-prs`, `dup-pipe-exit` — because negation
  asymmetry reads the whole memory, so a negation inside a *rationale* ("so a retry **cannot** bill
  twice") counts as if it negated the claim. Adding the second rule did not improve this; it only
  stopped making it worse.
- **"Four of five contradictions caught" was a number I should not have published.** It was
  measured on five pairs that all happened to contain a negation — the only thing the rule could
  see. Against 48 reversals it caught 29. The figure was not arithmetically wrong, it was
  unsupportable, and the fix was to build a corpus that could produce a bad score. See Result 3.
- **Preference inversion catches only 12 of 48 reversals on its own.** It is worth shipping because
  its errors are zero, not because its coverage is good: it is the second rule in an OR, not a
  replacement for the first.
- **The rule that scored best is not the one that shipped.** Scoping negation to shared vocabulary
  beat the shipped guard on every column (37/48 caught, 1/11 pool duplicates blocked). Rejected
  because its two constants were chosen by reading the evaluation corpus and its gain is entirely
  on the error that costs least. Reporting a win and then declining it is the same discipline as
  reporting a loss.
- **A corpus of 48 is still small, and it is mine.** Both classes were written by hand, so the
  corpus could in principle favour the guard. The two checkable constraints are the commit order —
  the corpus lands before any change to the guard — and the negation balance printed on every run.
  Neither is as good as a corpus somebody else wrote.
- **My `synonym` class turned out not to isolate synonymy.** It scores 0.80 on three configurations
  because the targets share enough other vocabulary with the queries that coverage alone finds
  them. The genuinely synonym-dependent cases are scattered across the `paraphrase` class, which is
  where the remaining failures sit. The class names describe what I intended, not perfectly what
  they measure.
- **The model is 3-4x over the latency budget.** 140-170ms per query against NFR-03's 50ms, which is
  why it is refused for recall however good its MRR is. The cost is one query embedding, so it
  does not grow with the store — at 10,000 memories the lexical path is p95 16.93ms and the model
  would add that ~165ms flat.
- **The model loses on exact-token queries.** exact-keyword 1.00 → 0.94, ranking 1.00 → 0.90. It
  ranks by meaning, so a query naming a rare token can be beaten by a memory merely about the
  subject.
- **The model merges contradictions more confidently than anything else.** At its best pairwise
  threshold it merges 4 of 5, because a better model is better at seeing that two sentences are
  *about* the same thing — which is exactly the wrong question when one of them negates the other.
  The guard is what makes it usable, and the guard still misses 12 reversals in 48.
- **Giving up pairwise F1 was unavoidable.** The thresholds now shipped score 0.63 and 0.78 where
  0.84 was achievable pairwise. That is a deliberate loss, taken to keep novel suppressions at
  zero.
- **The guard costs the model its top score.** Unguarded, the model reaches F1 0.85; guarded, 0.84.
  That one point buys four contradictions not merged, which is a trade worth making — but it is a
  real cost, not a free win.
- **Three queries fail in every configuration measured without a model.** `syn-rollback-fast`,
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

**Both of the decisions this report originally deferred were then taken** (ADR-028):

- **The de-duplication thresholds moved, and the number now belongs to the gateway** that produced
  the vectors rather than to the service. 0.20 for Jaccard, 0.25 for the in-tree vectors, 0.75 for
  a model. The selection rule is recorded as well as the values, because a larger pool will need
  them re-derived: lowest pool-scale threshold losing no novel memory, with one sweep step of
  margin.
- **`fastembed` 3.0.0 is a devDependency**, so the model is measurable without entering the
  runtime tree. Verified rather than assumed, since ADR-003 once accepted a risk against the wrong
  facts: `pnpm audit --prod` unchanged at exit 0, `pnpm why fastembed --prod` empty, and **no
  advisory at moderate or above has a path through `fastembed` or `onnxruntime-node`**. ADR-003's
  nine `tar` advisories came from version 1; version 3 brings none. That weakens the supply-chain
  half of ADR-017's reasoning and the record says so — but the ~130MB model download against a
  zero-config contract is a separate objection and it still stands.
- **The model is adopted for de-duplication and refused for recall.** De-duplication runs at
  promote time and has no latency budget; recall runs at the start of every substantive block and
  has a published one.

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
- **Pool scale is measured to 51 memories, not to thousands.** The quantity compared is a maximum
  over the pool, so the safe threshold can only move *upward* as the pool grows. The three values
  shipped are lower bounds measured on a small pool, which is why ADR-028 records the rule for
  re-deriving them rather than only the numbers.
- **The novel candidates are deliberately easy.** Twelve memories whose subject is absent from the
  pool. Easy is the point — a method that suppresses one of those would suppress anything — but it
  means the measurement says nothing about a candidate that is arguably a duplicate.
- **The polarity corpus is 48 cases and I wrote both sides of every one.** It is large enough to
  separate the guards and far too small to validate a rule with fitted parameters, which is the
  stated reason the better-scoring scoped variant was not adopted. The provenance constraints are
  the commit order and the printed negation balance; a corpus written by somebody else would be
  worth more than both.
- **The guard is measured against the fixture memory, not against the pool.** Each polarity case is
  scored against the one memory it was written for. At pool scale a candidate meets 50 other
  memories as well, and a guard firing against the wrong one of them is not measured here.
- **The dedup experiment measures the decision function, not the service.** It scores the similarity
  functions directly rather than driving `promote`, because `promote` needs a configured Railway URL
  and writes to a database a partner reads. That the better function is wired in correctly is a
  unit test's job, not this one's.

---

## Reproducing it

```bash
pnpm install
pnpm run experiment:recall     # the table above, plus the cosine floor sweep
pnpm run experiment:dedup      # the dedup tables, the F1 curve, and the guard comparison
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
  positives were contradictions; then added a guard that took false positives from 6 to **0** —
  precision 1.00 on the duplicate class.
- Did it with **no new runtime dependency**, no model download and no network, preserving a
  zero-config install contract and an existing supply-chain decision.
- Measured a real sentence-transformer against the same corpus and showed it **does** close the
  gap the in-tree vectors do not — paraphrase MRR 0.42 → 0.75, overall 0.76 → 0.86 — then
  **refused it for the default path** on a measured 3x latency-budget violation, and adopted it
  only where no budget applies.
- **Caught my own about-to-be-shipped regression with a measurement.** The threshold that
  maximises pairwise F1 suppresses 11 of 12 novel memories once applied as a maximum over a pool.
  Building the pool-scale experiment before making the change is the only reason the fix is a fix.
- **Reported that the headline improvement was not the feature everyone expected.** The embeddings
  contributed one query class and cost another; the scoring was the defect. The experiment carries a
  diagnostic configuration whose only purpose is to make that attribution impossible to get wrong.
- **Retracted one of my own published figures and built the corpus that could disprove it.** The
  contradiction guard was reported at "4 of 5"; on 48 reversals it was 29. Reading the contrast
  construction as well as the negation took it to 36 at no measured cost, and the variant that
  scored best — 37, with a quarter of the false blocks — was **declined** because its two constants
  were fitted on the evaluation corpus.

The last two are the only items on this list a reader cannot get from a changelog, and they are the
ones worth leading with.
