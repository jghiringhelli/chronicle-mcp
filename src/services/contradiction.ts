/**
 * Negation mismatch — the guard that keeps de-duplication from deleting a policy.
 *
 * ## The measured problem
 *
 * De-duplication asks "are these the same knowledge?" and answers with text similarity. Over 32
 * hand-labelled pairs (`experiments/dedup`), the two most similar pairs in the entire corpus were
 * both **contradictions**:
 *
 * | pair                                                      | Jaccard | cosine |
 * |-----------------------------------------------------------|---------|--------|
 * | "bodies are never logged" / "bodies are logged at debug"  | 0.667   | 0.726  |
 * | "I avoid mocks, prefer a fake" / "I prefer mocks, avoid fakes" | 0.556 | 0.616 |
 *
 * while the most similar genuine duplicate scored 0.313 by Jaccard and 0.534 by cosine. The
 * ordering is inverted at the top: a negation is one token, so reversing a statement's meaning
 * barely moves a bag-of-words similarity, and any threshold high enough to look safe fires on
 * contradictions and nothing else. At the shipped threshold of 0.5, de-duplication's only two
 * positives were those two pairs — it caught no duplicates at all and silently withheld two
 * memories that reversed a policy.
 *
 * Raising or lowering the threshold cannot fix that, because the problem is the ordering rather
 * than the cut point. This guard changes the ordering instead.
 *
 * ## What the guard can and cannot do
 *
 * It is **strictly safety-improving**: it can only turn a merge into a non-merge, never the
 * reverse. The worst case is leaving a near-duplicate in the pool, which somebody can see and
 * delete; the error it prevents is withholding a memory, which nobody observes.
 *
 * It catches four of the five labelled contradictions. It does **not** catch
 * "avoid mocks, prefer a fake" against "prefer mocks, avoid fakes", because neither sentence
 * contains a negation — the reversal is carried by swapping two verbs, and detecting that needs
 * to understand the sentence rather than scan it. That pair is the honest limit of this
 * approach and it is asserted as such in the tests.
 */

/**
 * Tokens that reverse the meaning of the clause they appear in.
 *
 * Only unambiguous negations. Hedges like `rarely` or `usually` are excluded on purpose: they
 * narrow a claim rather than reverse it, and treating "we rarely deploy on Friday" as a
 * contradiction of "we do not deploy on Friday" would block a merge that should happen.
 */
const NEGATIONS: ReadonlySet<string> = new Set([
  'not', "n't", 'never', 'no', 'none', 'nor', 'neither',
  'cannot', 'without', 'avoid', 'avoids', 'avoided',
  'forbidden', 'disallowed', 'prohibited',
]);

/**
 * Count the negating tokens in a text.
 *
 * Contractions are expanded first, because `don't` and `do not` must count the same — a
 * tokenizer that splits on non-letters turns the first into `don` and `t`, and `t` is below the
 * length floor, so the negation would vanish entirely.
 *
 * @param text - Raw text
 * @returns How many negating tokens appear
 */
function negationCount(text: string): number {
  const normalised = text
    .toLowerCase()
    .replace(/\b(\w+)n't\b/g, '$1 not')
    .split(/[^a-z0-9]+/);
  return normalised.filter((t) => NEGATIONS.has(t)).length;
}

/**
 * Whether two texts disagree about negation, and so must not be merged.
 *
 * The test is asymmetry in negation, not its presence: two statements that both say "never" are
 * in agreement, and two that both say nothing of the kind are equally fine. It is the pair where
 * one negates and the other does not that reverses a meaning.
 *
 * @param a - First text
 * @param b - Second text
 * @returns true when one text negates and the other does not
 */
export function negationMismatch(a: string, b: string): boolean {
  const na = negationCount(a);
  const nb = negationCount(b);
  return (na === 0) !== (nb === 0);
}
