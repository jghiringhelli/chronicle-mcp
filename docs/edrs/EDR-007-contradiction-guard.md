---
id: EDR-007
type: edr
status: active
tier: T2
properties: [verifiable, auditable, executable]
obligations: 6
depends_on: [ADR-028, ADR-019]
---

# EDR-007: The contradiction guard — negation asymmetry and preference inversion

**Governs:** `src/services/contradiction.ts`,
`src/services/team-promotion-service.ts` (the duplicate branch of `promote`)
**Derives from:** ADR-028 (a dedup threshold belongs to its gateway; the guard is what makes any
threshold safe), ADR-019 §1 (insights are shared — a withheld insight is a silent failure of the
one thing team promotion exists to do)

## Function — what this unit does

Answers one question, for two texts: *would merging these delete a decision?*

`TeamPromotionService.promote` finds the pool memory most similar to a candidate and skips the
candidate when that similarity clears the gateway's threshold. This unit can veto that skip. It
sits in front of the threshold because the threshold cannot do its job: over the labelled pairs
in `experiments/dedup`, **contradictions outscore genuine duplicates**, so every cut point high
enough to look safe fires on reversals and nothing else.

**Contract**

- The guard is **one-directional**: it can only turn a merge into a non-merge. Its false
  positives leave a near-duplicate in the pool, which somebody can see and delete. Its false
  negatives withhold a memory that reverses a policy, which nobody observes. The two errors are
  not comparable and the unit is biased accordingly.
- It MUST NOT depend on the similarity method. Jaccard, the in-tree vectors and a
  sentence-transformer all hand it the same two strings.
- It is **symmetric** and **synchronous**. A guard that needed to embed anything would put a
  model on the promote path, which ADR-028 §2 refuses.
- Agreement is not contradiction. Two memories that both forbid the same thing are duplicates
  like any other pair, and merging them is correct.
- A hedge narrows a claim, it does not reverse one. "We rarely ship on Friday" must stay
  mergeable with "we do not ship on Friday".

## Implementation — what is load-bearing

Two rules, OR-ed by `contradicts`, which is the only function a caller should use.

**1. Negation asymmetry** (`negationMismatch`). Exactly one side negates. Tests asymmetry rather
than presence, so `never`/`never` is agreement. Contractions are expanded first: a tokenizer that
splits on non-letters turns `don't` into `don` + `t`, and `t` is below every length floor, so the
negation would vanish entirely.

**2. Preference inversion** (`preferenceInversion`). A contrast marker — `rather than`,
`instead of`, `not`, `replaced`, … — splits a text into the alternative it **keeps** and the one
it **rejects**. The rule fires when each text keeps something the other rejects.

Three choices inside rule 2 are load-bearing, and all three look like oversights:

- **The crossing must hold in BOTH directions.** One direction is trivial to satisfy: any memory
  that rejects something the other merely mentions would trip it. The two-sided form is the whole
  reason this rule blocks **zero** restatements, zero pool duplicates and zero pairwise
  duplicates — it is pure added signal, costing nothing on any measured negative class.
- **The rejected span ends at a clause boundary**, not after a fixed number of words. With a
  six-word window, "avoid mocks **and prefer a fake**" put `fake` on the rejected side of both
  texts; the two sides overlapped and the rule scored **0 of 5** on the labelled contradictions.
- **`once` is absent from `CLAUSE_BOUNDARIES`** although it is a subordinator in "once it was
  clear". It is also a frequency adverb, and in that use it *begins* the rejected alternative —
  "on each line item rather than **once on the total**" — so including it truncated the span to
  nothing on exactly the construction the rule exists to read.

A plural `s` is stripped before comparing, because the two sides of a preference are routinely
written with different number: "prefer a fake" against "avoid hand-written **fakes**". Without it
that pair — the one `contradiction.ts` previously documented as undetectable — stays undetected.

## Verification

`experiments/dedup/polarity.ts` reverses the standing decision in each of the **48** fixture
memories that states one, and restates the same decision beside it. Each memory therefore
contributes one text that must be flagged and one that must not. Both classes are required: a
corpus of only contradictions makes every guard look free.

| rule | reversals caught /48 | restatements blocked /48 | `opposite` pairs /5 |
|---|---|---|---|
| negation only (previous) | 29 | 9 | 4 |
| preference inversion only | 12 | **0** | 1 |
| **negation OR inversion (shipped)** | **36** | 9 | **5** |

Adding rule 2 cost nothing: restatements blocked, pool duplicates (4/11) and pairwise duplicates
(3/11) are all unchanged. It also lifted the de-duplication F1 the guard fronts, from 0.59 to
**0.63** by default and 0.74 to **0.78** with a model, with **0** contradictions merged at the
shipped thresholds. ADR-028's thresholds (0.20 / 0.25 / 0.75) were re-measured against the pool
and still lose zero novel memories, so they did not move.

The corpus reports its own soundness rather than asserting it: **29 of 48** reversals and **23 of
48** restatements contain a negation. Had negations clustered in one class, "contains a negation"
would *be* the label and the table above would measure the corpus instead of the guard.

## Measured and deliberately not adopted

Restricting rule 1 to negations whose neighbourhood overlaps the other text's vocabulary scores
**37/48** caught, 9 restatements, 5/5 opposites, and cuts the duplicate cost to **1/11** pool and
**0/11** pairwise — dominant on every column.

It is not shipped. It needs a window width and a shared-token floor, and both were chosen by
reading this corpus; the rule it would replace has no numeric parameter to overfit, and the entire
gain is on the **cheap** error. It lives in `experiments/dedup/guards.ts` as
`scopedNegationMismatch` and is printed with the results on every run, so a larger corpus can
settle it. Re-deriving it is the named follow-up, not a loose end.

## The honest limit

**12 of 48** reversals are caught by neither rule: those that reverse a claim by substituting an
antonym with no contrast marker and no negation — "stored as integer cents" against "stored as
floating point doubles". Detecting those needs lexical knowledge this unit does not have.
`tests/unit/services/contradiction.test.ts` asserts that miss rather than hiding it, so the limit
cannot shift unnoticed.

## Pitfalls

- A service-level test of this guard can pass **without the guard being consulted**. The first
  version of the preference-inversion wiring test did: the `FakeEmbeddings` double in
  `team-promotion-service.test.ts` scores that pair 0.00, so the candidate never reached the
  threshold and the duplicate branch was never entered. It now builds a service with no gateway,
  takes the lexical path where the real Jaccard is 0.56 against a 0.20 threshold, and was
  confirmed to **fail** when the service is reverted to `negationMismatch`.
- Do not copy either rule's lexicon into a caller. `experiments/dedup/run.ts` imports
  `contradicts` for exactly this reason — it held its own copy of the guard for one commit, and
  reported numbers for a guard the product had stopped using.
