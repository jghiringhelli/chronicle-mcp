/**
 * Recall ranking — the query-dependent half of recall, as pure functions.
 *
 * ## Why this module exists
 *
 * Recall had no ranking. `SqliteMemoryRepository.recall` filtered with `content LIKE` and then
 * ordered by `weight DESC`, returning `row.weight` as the "relevance score" — so the ordering
 * never consulted the query at all, and a memory matching one of five query words outranked
 * one matching all five whenever it happened to weigh more. Measured over a labelled corpus
 * that cost MRR 0.26 against 0.42 recall@5 (`docs/evidence/recall-experiment.json`).
 *
 * Everything here is pure: text and numbers in, scores out. No database, no I/O, no clock. That
 * is what lets the recall experiment measure the ranking in isolation from retrieval, and it is
 * why a ranking change can be tested without a fixture database.
 *
 * ## The two scores and why both are kept
 *
 * `lexicalScore` answers "how much of what was asked appears here", and it is the right answer
 * for a query whose words are in the memory. `cosine` over lexical vectors answers "how close
 * are these two texts in a space where word forms and substrings count", which rescues the
 * morphological near-misses that a substring match cannot see. They fail on different queries,
 * so `reciprocalRankFusion` combines their rankings rather than their scores — see the note on
 * that function for why fusing ranks is the safer of the two.
 */

import { tokenize } from '../shared/text.js';

/** Bonus when the whole query appears verbatim in the content. */
const PHRASE_BONUS = 0.5;

/** Bonus when a query token matches one of the memory's curated tags. */
const TAG_BONUS = 0.15;

/**
 * Weight's contribution to the lexical score.
 *
 * Small on purpose. Weight is Chronicle's model of durability — how reinforced and how recently
 * used a memory is — and it is a reasonable tiebreaker between two equally relevant memories.
 * It is not relevance, and the defect being corrected here is precisely what happens when it is
 * allowed to act as if it were. At 0.05 it can reorder a tie and cannot overturn a difference in
 * coverage.
 */
const WEIGHT_TIEBREAK = 0.05;

/** The subset of a memory that ranking reads. Keeps the function usable without an entity. */
export interface Rankable {
  id: string;
  content: string;
  tags?: readonly string[];
  category?: string;
  /** Durability in [0, 1]. Used only as a tiebreaker. */
  weight?: number;
}

/**
 * Score how well a memory answers a query, by lexical overlap.
 *
 * The score is coverage-led: the fraction of the query's content words that appear in the
 * memory, plus a bonus for an exact phrase and a smaller one for a tag hit. Coverage rather
 * than a raw match count, because a count rewards long memories for containing more words,
 * which is the opposite of what a reader wants from a recall list.
 *
 * No IDF. Inverse document frequency needs corpus statistics, which would make the score depend
 * on what else is in the store and on when it was computed — a ranking that changes under an
 * unrelated write is not something a user can reason about, and the stop word list already
 * removes the terms IDF would mostly be discounting.
 *
 * @param query - The raw query text
 * @param memory - The memory being scored
 * @returns Score in [0, 1.7]; 0 when the query has no content words
 */
export function lexicalScore(query: string, memory: Rankable): number {
  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) return 0;

  const contentTokens = new Set(tokenize(memory.content));
  const tagTokens = new Set((memory.tags ?? []).flatMap((t) => tokenize(t)));
  if (memory.category) for (const t of tokenize(memory.category)) tagTokens.add(t);

  let matched = 0;
  let tagHit = false;
  for (const qt of queryTokens) {
    if (contentTokens.has(qt)) matched++;
    else if (tagTokens.has(qt)) { matched++; tagHit = true; }
  }

  const coverage = matched / queryTokens.length;
  if (coverage === 0) return 0;

  const phrase = memory.content.toLowerCase().includes(query.trim().toLowerCase()) ? PHRASE_BONUS : 0;
  const tag = tagHit ? TAG_BONUS : 0;
  return coverage + phrase + tag + WEIGHT_TIEBREAK * (memory.weight ?? 0);
}

/**
 * Rank ids by a score, highest first, with a deterministic tiebreak.
 *
 * Ties are broken by id rather than left to the sort's stability, so two runs over the same data
 * produce the same list on every engine. An experiment whose output depends on sort
 * implementation is not reproducible, and that is the claim this repository is making about it.
 *
 * @param scored - Candidates with their scores
 * @returns Ids ordered best-first, zero and negative scores dropped
 */
export function rankByScore(scored: Array<{ id: string; score: number }>): string[] {
  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => (b.score - a.score) || a.id.localeCompare(b.id))
    .map((s) => s.id);
}

/**
 * Reciprocal rank fusion constant.
 *
 * 60 is the value from Cormack, Clarke and Buettcher's original formulation and the one most
 * systems use unchanged. It controls how sharply the first few positions dominate: at k=60 the
 * gap between rank 1 and rank 2 is small enough that a list which is confident and wrong cannot
 * override a list which is right but less emphatic.
 */
const RRF_K = 60;

/**
 * Fuse several ranked lists into one.
 *
 * Fusing **ranks** rather than scores is the load-bearing choice. The two rankers produce
 * numbers on incomparable scales — `lexicalScore` is coverage-led and can exceed 1, cosine is
 * bounded by 1 and clusters tightly — so any weighted sum of the scores would be dominated by
 * whichever scale happened to be wider, and the weights would need retuning every time either
 * scorer changed. Rank fusion needs no calibration between the inputs and no shared scale; it
 * only needs each list to be ordered, which is the one property both reliably have.
 *
 * A document ranked by only one list still accumulates that list's contribution, so a memory
 * that only the vector path found is not discarded — it simply needs a good rank there to beat
 * a memory both paths agree on.
 *
 * @param lists - Ranked id lists, best-first
 * @param k - Fusion constant; defaults to RRF_K
 * @returns Ids ordered by fused score, best-first, ties broken by id
 */
export function reciprocalRankFusion(lists: string[][], k = RRF_K): string[] {
  const fused = new Map<string, number>();
  for (const list of lists) {
    list.forEach((id, index) => {
      fused.set(id, (fused.get(id) ?? 0) + 1 / (k + index + 1));
    });
  }
  return [...fused.entries()]
    .sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0]))
    .map(([id]) => id);
}
