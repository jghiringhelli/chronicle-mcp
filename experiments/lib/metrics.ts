/**
 * Relevance metrics — MRR, P@k, R@k, F1@k.
 *
 * The arithmetic is deliberately identical to CodeSeeker's
 * `tests/relevance/metrics.test.ts`, so a number produced here can be set beside a number
 * produced there and the comparison means something. Same five metrics, same rank convention,
 * same aggregation (mean over cases, each case weighted equally regardless of how many
 * relevant items it has).
 *
 * Rank convention: **1-based, and 0 means "not found in the returned list"**. Every function
 * here takes the per-target rank array for one query, so a case with three relevant memories
 * of which the second was never returned is `[2, 0, 7]`.
 *
 * Why MRR is the headline: a recall tool hands its output to a model with a read budget. What
 * matters is whether the right memory is near the top, not whether it is somewhere in the
 * list — and MRR is the metric that punishes rank 7 as nearly worthless, which is honest about
 * how the output is consumed.
 */

/** One query's outcome: the 1-based rank of each relevant item, 0 when it was not returned. */
export type Ranks = number[];

/**
 * Reciprocal rank — 1 / (best rank found), or 0 when nothing relevant came back.
 *
 * @param ranks - 1-based ranks of the relevant items, 0 for missing
 * @returns Reciprocal rank in [0, 1]
 */
export function rr(ranks: Ranks): number {
  const found = ranks.filter((r) => r > 0).sort((a, b) => a - b);
  const best = found[0];
  return best ? 1 / best : 0;
}

/**
 * Precision at k — of the top-k slots, how many hold a relevant item.
 *
 * Note the denominator is k, not the number of relevant items. A query with one relevant
 * memory therefore caps at 1/3 for P@3: that is the standard definition and it is why P@3 is
 * read as a trend across configurations rather than as an absolute score.
 *
 * @param ranks - 1-based ranks of the relevant items, 0 for missing
 * @param k - Cutoff rank
 * @returns Precision in [0, 1]
 */
export function precisionAtK(ranks: Ranks, k: number): number {
  if (k <= 0) return 0;
  const hits = ranks.filter((r) => r > 0 && r <= k).length;
  return hits / k;
}

/**
 * Recall at k — the fraction of relevant items that appear within the top k.
 *
 * A case with no relevant items (an out-of-scope query) scores 1: there was nothing to find
 * and nothing was missed. Precision is what judges those cases, via `mustNotFind`.
 *
 * @param ranks - 1-based ranks of the relevant items, 0 for missing
 * @param k - Cutoff rank
 * @returns Recall in [0, 1]
 */
export function recallAtK(ranks: Ranks, k: number): number {
  if (ranks.length === 0) return 1;
  return ranks.filter((r) => r > 0 && r <= k).length / ranks.length;
}

/**
 * Harmonic mean of precision and recall.
 *
 * @param p - Precision
 * @param r - Recall
 * @returns F1 in [0, 1]; 0 when both inputs are 0
 */
export function f1(p: number, r: number): number {
  return p + r > 0 ? (2 * p * r) / (p + r) : 0;
}

/**
 * Arithmetic mean, 0 for an empty sample.
 *
 * @param values - Sample
 * @returns Mean
 */
export function mean(values: number[]): number {
  return values.length ? values.reduce((s, v) => s + v, 0) / values.length : 0;
}

/** The five metrics reported for a configuration, matching CodeSeeker's set. */
export interface MetricSet {
  /** Mean reciprocal rank — the headline. */
  mrr: number;
  /** Precision at 1. */
  p1: number;
  /** Precision at 3. */
  p3: number;
  /** Recall at 5 — the reviewer's second requested metric. */
  r5: number;
  /** F1 of P@3 and R@3. */
  f1at3: number;
  /** How many query cases went into these means. */
  cases: number;
}

/**
 * Aggregate per-case rank arrays into the five-metric set.
 *
 * Each case contributes equally to every mean. That is CodeSeeker's choice and it is kept
 * here: weighting by the number of relevant items would let one multi-relevant query dominate
 * the score, which hides exactly the single-target failures a recall tool is judged on.
 *
 * @param perCase - One rank array per query case
 * @returns The five metrics plus the case count
 */
export function aggregate(perCase: Ranks[]): MetricSet {
  return {
    mrr: mean(perCase.map((r) => rr(r))),
    p1: mean(perCase.map((r) => precisionAtK(r, 1))),
    p3: mean(perCase.map((r) => precisionAtK(r, 3))),
    r5: mean(perCase.map((r) => recallAtK(r, 5))),
    f1at3: mean(perCase.map((r) => f1(precisionAtK(r, 3), recallAtK(r, 3)))),
    cases: perCase.length,
  };
}

/**
 * Format a metric as a fixed 2-decimal string for the report table.
 *
 * @param v - Metric value
 * @returns Two-decimal string
 */
export function fmt(v: number): string {
  return v.toFixed(2);
}

/**
 * Round to four decimals for the evidence JSON.
 *
 * Four, not full float: the committed artefact is compared across runs and machines, and
 * trailing float noise would read as a change when nothing moved.
 *
 * @param v - Metric value
 * @returns Rounded value
 */
export function round4(v: number): number {
  return Math.round(v * 10000) / 10000;
}
