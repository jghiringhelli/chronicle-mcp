# Experiments

Measured answers to the two questions Chronicle could not previously answer about itself:

1. **Does recall find the right memory?** — `experiment:recall`
2. **Does semantic de-duplication beat the lexical one?** — `experiment:dedup`

Both are reproducible from a clean checkout with no credentials, no network and no model
download. Each builds its own SQLite database under the OS temp directory and deletes it
afterwards; neither reads `~/.chronicle/chronicle.db`.

```bash
pnpm run experiment:recall     # MRR / R@5 per configuration, against the committed baseline
pnpm run experiment:dedup      # precision / recall / F1 for lexical vs semantic dedup
pnpm run experiments           # both
```

Add `-- --update-baseline` to re-record the baseline after a deliberate change.

## Method

Copied from CodeSeeker's `tests/relevance/`, so that a Chronicle number and a CodeSeeker number
can be set side by side and the comparison means something:

- A **hand-labelled corpus**. Each case is a query a developer would actually type, the
  memories that must come back, a rank ceiling, and tags for grouped analysis.
- **1-based ranks, 0 for not returned.** Every metric is computed from the per-target rank
  array of one query.
- **The same five metrics** — MRR, P@1, P@3, R@5, F1@3 — with the same arithmetic
  (`lib/metrics.ts`) and the same aggregation: the mean over cases, each case weighted equally
  however many relevant items it has.
- **A committed baseline** plus a regression threshold, so a later change that degrades recall
  fails the run instead of being discovered in use.

Two deliberate departures, both because the subject is a memory store rather than a codebase:

- Targets are memory **ids**, not filename substrings. A memory has no path.
- There is an **out-of-scope class**. Code search always has some nearest file; a memory store
  legitimately holds nothing about Bluetooth, and answering anyway is how an assistant comes to
  cite a memory that does not apply. Those cases are excluded from the five metrics — a
  constant 0 added to every configuration's MRR would move every number by the same amount and
  inform nobody — and reported separately as a false-positive rate.

### Reading the numbers

**MRR is the headline.** Recall output goes to a model with a read budget, so what matters is
whether the right memory is near the top, not whether it is somewhere in the list. MRR punishes
rank 7 as nearly worthless, which is honest about how the output is consumed. **R@5** is the
second headline: the fraction of relevant memories that made the top five.

P@3 caps at 0.33 for a single-target query by definition — the denominator is k, not the number
of relevant items — so read it as a trend between configurations, never as an absolute score.

## Provenance — why the corpus can be trusted

The experiment and the thing it measures were written by the same person, which is the standard
way a benchmark comes to flatter its subject. Three checkable constraints stand against that:

1. **The corpus was committed before the ranker existed.** `lib/fixture.ts`,
   `recall/corpus.ts`, `lib/metrics.ts` and the red baseline landed in one commit; the embedding
   gateway and the scored recall path landed in later ones. `git log --follow` on these files
   against the gateway's first commit is the evidence, and it is the reason the work was
   sequenced this way rather than built in one pass.
2. **The queries were written before the labels.** Each case's `description` field records *why*
   those targets and not others. Where a memory is on the same topic but does not answer the
   question it is deliberately left unlabelled — `m-lesson-green-gate` is not a target for "the
   suite passes but the real integration is broken" — because labelling the neighbourhood
   instead of the answer is how a corpus stops discriminating between configurations.
3. **The fixture is adversarial on purpose.** Distractors share vocabulary with the queries
   (eight memories mention `retry`, five mention `queue`), and weights are set so that relevance
   and weight disagree: some exact-match targets carry the lowest weights in the fixture while
   irrelevant distractors carry the highest. A corpus without that scores 1.00 everywhere.

**What this still does not establish.** The corpus is one author's judgement about what a query
means, on synthetic memories, at a size (51 memories) far below a real store. It measures whether
a configuration ranks a known answer highly; it does not measure whether the answer was worth
storing, and it cannot detect a failure mode nobody thought to write a query for. A second
labeller, real memories and a larger corpus would each strengthen it, and none of the three is
present.

## Layout

```
experiments/
  README.md              this file — method, provenance, limits
  lib/metrics.ts         MRR, P@k, R@k, F1 — CodeSeeker's arithmetic
  lib/fixture.ts         51 hand-written memories, with adversarial weights
  recall/corpus.ts       35 labelled queries in seven classes
  recall/run.ts          runner: seeds, measures every configuration, writes evidence
  dedup/pairs.ts         32 labelled duplicate / non-duplicate memory pairs
  dedup/pool.ts          the pool-scale question: max similarity over the whole store
  dedup/polarity.ts      48 fixture decisions, each reversed AND restated — the guard corpus
  dedup/guards.ts        candidate contradiction guards, including one measured but not adopted
  dedup/run.ts           runner: lexical vs semantic vs model, threshold sweep, guard comparison
  baseline-recall.json   committed headline metrics; a drop past the threshold fails the run
  baseline-dedup.json    the same, for de-duplication
```

Results land in `docs/evidence/recall-experiment.json` and
`docs/evidence/dedup-experiment.json` on every run, including a failing one: the record of a
regression is evidence too. The prose write-up of a run lives in `reports/`.
