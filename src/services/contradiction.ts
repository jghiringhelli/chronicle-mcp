/**
 * The contradiction guard — what keeps de-duplication from deleting a policy.
 *
 * Two independent rules, OR-ed: **negation asymmetry** (`negationMismatch`) and **preference
 * inversion** (`preferenceInversion`). `contradicts` is the one a caller should use.
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
 * ## Why negation alone was not enough, and how that was found out
 *
 * Negation asymmetry caught four of those five labelled pairs, and five pairs is far too few to
 * say anything about a guard. `experiments/dedup/polarity.ts` reverses the standing decision in
 * every one of the 48 fixture memories that states one, and restates the same decision beside
 * it, so each memory contributes one text that must be flagged and one that must not. Against
 * that corpus negation asymmetry alone catches **29 of 48** reversals — not the 80% the five
 * pairs implied, because all five happened to carry a negation.
 *
 * The 19 it missed are reversals carried by **swapping two alternatives** rather than by
 * negating one: "rounded on each line item rather than on the total" against "rounded on the
 * total rather than on each line item". Nothing is negated; the preference is inverted. English
 * marks that with a contrast construction, and `preferenceInversion` reads it.
 *
 * Together: **36 of 48** reversals and 5 of 5 of the original labelled pairs — including
 * "avoid mocks, prefer a fake" against "prefer mocks, avoid fakes", which the previous version
 * of this file documented as the limit of the approach. The false blocks did not move: 9 of 48
 * restatements, 4 of 11 pool duplicates, 3 of 11 pairwise duplicates, all unchanged. Adding the
 * second rule cost nothing on any measured negative class.
 *
 * ## What was measured and deliberately not adopted
 *
 * Restricting the negation test to negations whose neighbourhood overlaps the other text's
 * vocabulary cuts the pool-duplicate false blocks from 4 to 2 and the pairwise ones from 3 to 1,
 * holding reversals at 36. It is not here, because it needs a window width and a shared-token
 * floor, both chosen by reading this corpus — and the gain is entirely on the **cheap** error, a
 * visible duplicate, not on the expensive one. The numbers are in the experiment output so the
 * choice can be revisited against a larger corpus, which is the only thing that could justify
 * fitting them. See `reports/experiment-recall-and-dedup-2026-11-10.md`.
 *
 * The honest remaining limit is 12 reversals in 48 that neither rule sees — those that reverse a
 * claim by substituting an antonym with no contrast marker at all ("stored as integer cents"
 * against "stored as floating point doubles"). Detecting those needs lexical knowledge this
 * module does not have, and the tests assert the miss rather than hiding it.
 */

import { tokenize } from '../shared/text.js';

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

/**
 * Words after which English names the alternative being **rejected**.
 *
 * A lexicon, like `NEGATIONS`, not a tuned parameter. `replaced` and `dropped` are here because
 * a memory that records a decision usually names what it replaced — "Bcrypt was replaced during
 * the security review" puts bcrypt on the rejected side, and the reversal of that memory puts it
 * on the kept side, which is exactly the signal.
 */
const CONTRAST_MARKERS: readonly string[] = [
  'rather than', 'instead of', 'no longer',
  'not', 'never', 'avoid', 'avoids', 'without',
  'replaced', 'rejected', 'dropped', 'removed',
];

/**
 * Words that end the span a contrast marker governs.
 *
 * Without this the span runs to the end of the sentence and swallows the kept alternative along
 * with the rejected one, which makes the two sides overlap and the rule fire on nothing. That
 * was not a tuning choice: a fixed window of six words scored 0 of 5 on the labelled
 * contradictions precisely because "avoid mocks **and prefer a fake**" put `fake` on the
 * rejected side.
 *
 * `once` is deliberately **absent**, although it is a subordinator in "once it was clear". It is
 * also a frequency adverb, and in that use it begins the rejected alternative rather than ending
 * it — "rounded on each line item rather than **once on the total**" — so including it cut the
 * span to nothing on exactly the construction this rule exists to read. No other entry here is
 * ambiguous that way. Dropping it gained one reversal of 48 and cost nothing on any negative
 * class; dropping the other debatable entries (`after`, `while`, `then`) moved no number at all,
 * so they stay.
 */
const CLAUSE_BOUNDARIES: ReadonlySet<string> = new Set([
  'and', 'but', 'or', 'because', 'so', 'which', 'since', 'after', 'while',
  'though', 'although', 'then', 'that', 'until', 'whenever', 'if',
]);

/**
 * Strip a plural `s`, so `fake` and `fakes` compare equal.
 *
 * The narrowest useful morphology and nothing more. It is needed rather than cosmetic: the two
 * sides of a preference are routinely written with different number — "prefer a fake" against
 * "avoid hand-written fakes" — and without it that pair, the one this module previously
 * documented as undetectable, stays undetected. `ss` is left alone so `class` does not become
 * `clas`.
 *
 * @param token - A content token
 * @returns The token without a trailing plural `s`
 */
function singularise(token: string): string {
  return token.length > 3 && token.endsWith('s') && !token.endsWith('ss') ? token.slice(0, -1) : token;
}

/**
 * Content tokens of a text, contractions expanded and plurals folded.
 *
 * @param text - Raw text
 * @returns Normalised content tokens in order
 */
function contentTokens(text: string): string[] {
  return tokenize(text.toLowerCase().replace(/\b(\w+)n't\b/g, '$1 not')).map(singularise);
}

/**
 * Indices of the raw words that fall inside a rejected span.
 *
 * @param words - Raw lowercase words of the text
 * @returns The indices a contrast marker governs
 */
function rejectedSpans(words: string[]): Set<number> {
  const bare = (w: string | undefined): string => (w ?? '').replace(/[^a-z']/g, '');
  const indices = new Set<number>();
  for (let i = 0; i < words.length; i++) {
    const one = bare(words[i]);
    const two = `${one} ${bare(words[i + 1])}`;
    const width = CONTRAST_MARKERS.includes(two) ? 2 : CONTRAST_MARKERS.includes(one) ? 1 : 0;
    if (!width) continue;
    for (let j = i + width; j < words.length; j++) {
      const word = words[j] ?? '';
      if (CLAUSE_BOUNDARIES.has(bare(word))) break;
      indices.add(j);
      // A trailing comma, semicolon or full stop ends the span too: the marker governs one
      // phrase, and the clause after the punctuation is a separate claim.
      if (/[,;.]$/.test(word)) break;
    }
    i += width - 1;
  }
  return indices;
}

/** The alternatives a text keeps and the ones it rejects. */
interface ContrastSides {
  kept: ReadonlySet<string>;
  rejected: ReadonlySet<string>;
}

/**
 * Split a text into the alternatives it keeps and the ones it rejects.
 *
 * A token that appears on the rejected side is removed from the kept side, so "not on the total"
 * does not also count the total as kept. The asymmetry is deliberate: a statement is read as
 * rejecting what its contrast marker points at, and keeping everything else it mentions.
 *
 * @param text - Raw text
 * @returns The two sides as token sets
 */
function contrastSides(text: string): ContrastSides {
  const words = text.toLowerCase().split(/\s+/);
  const spans = rejectedSpans(words);
  const rejected = new Set(contentTokens(words.filter((_, j) => spans.has(j)).join(' ')));
  const kept = new Set(
    contentTokens(words.filter((_, j) => !spans.has(j)).join(' ')).filter((t) => !rejected.has(t)),
  );
  return { kept, rejected };
}

/**
 * Whether two texts express **opposite preferences** between the same alternatives.
 *
 * The test is deliberately two-sided: something one text rejects must be kept by the other AND
 * something the other rejects must be kept by the first. One direction alone is far too easy to
 * satisfy — a memory that rejects anything the other happens to mention would trip it — and the
 * two-sided form is what makes this rule block **zero** genuine restatements, pool duplicates and
 * pairwise duplicates across every corpus in `experiments/dedup`. It is pure added signal.
 *
 * @param a - First text
 * @param b - Second text
 * @returns true when each text keeps something the other rejects
 */
export function preferenceInversion(a: string, b: string): boolean {
  const left = contrastSides(a);
  const right = contrastSides(b);
  const crosses = (from: ContrastSides, to: ContrastSides): boolean =>
    [...from.rejected].some((token) => to.kept.has(token));
  return crosses(left, right) && crosses(right, left);
}

/**
 * Whether two texts contradict each other and so must not be merged.
 *
 * This is the function callers want. Either rule firing is enough, because both answer the same
 * question — does merging these two texts delete a decision — and a guard that demanded both
 * would catch less than either alone.
 *
 * @param a - First text
 * @param b - Second text
 * @returns true when the texts disagree about negation or invert a preference
 */
export function contradicts(a: string, b: string): boolean {
  return negationMismatch(a, b) || preferenceInversion(a, b);
}
