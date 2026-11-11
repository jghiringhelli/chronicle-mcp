/**
 * Contradiction-guard measurement — which rule, and what each one costs.
 *
 * The de-duplication threshold experiment in `run.ts` measures the **similarity method**. This
 * measures the **guard** that sits in front of it, which is a different question with a
 * different corpus: `polarity.ts`, where every fixture memory that states a standing decision
 * contributes one text that must be flagged and one that must not.
 *
 * Both sides have to be counted together. A guard is strictly safety-improving — it can only
 * turn a merge into a non-merge — so a corpus made only of contradictions makes every guard look
 * free, and a corpus made only of duplicates makes every guard look harmful. The table here puts
 * the catch and the cost in the same row.
 *
 * The negatives come from three places on purpose, because they fail in different ways:
 * `restated` is a paraphrase written against the same memory, `DUPLICATE_OF` is a duplicate
 * labelled before any guard existed, and the pairwise duplicates in `pairs.ts` were labelled
 * before the fixture was wired to this corpus at all. A guard that blocked none of the first and
 * many of the second would be telling us the corpus was written to suit it.
 */

import { negationMismatch, preferenceInversion, contradicts } from '../../src/services/contradiction.js';
import { tokenize } from '../../src/shared/text.js';
import { FIXTURE } from '../lib/fixture.js';
import { DEDUP_PAIRS } from './pairs.js';
import { DUPLICATE_OF } from './pool.js';
import { POLARITY, EXCLUDED } from './polarity.js';

/** A candidate guard: does merging these two texts delete a decision? */
export type Guard = (a: string, b: string) => boolean;

/** What one guard catches, and what it costs, on every labelled class available. */
export interface GuardResult {
  name: string;
  /** Of 48 reversed decisions, how many were correctly refused. Higher is better. */
  reversalsCaught: number;
  /** Of 48 restatements of the same decision, how many were wrongly refused. Lower is better. */
  restatementsBlocked: number;
  /** Of the 5 `opposite` pairs in `pairs.ts`, how many were caught. */
  oppositesCaught: number;
  /** Of 11 duplicates labelled against the pool, how many were wrongly refused. */
  poolDuplicatesBlocked: number;
  /** Of 11 pairwise duplicates, how many were wrongly refused. */
  pairwiseDuplicatesBlocked: number;
  /** Whether this rule is the one the product ships. */
  shipped: boolean;
}

const NEGATIONS: ReadonlySet<string> = new Set([
  'not', 'never', 'no', 'none', 'nor', 'neither',
  'cannot', 'without', 'avoid', 'avoids', 'avoided',
  'forbidden', 'disallowed', 'prohibited',
]);

/**
 * The variant that was measured and **not** adopted: negation restricted to shared vocabulary.
 *
 * A negation attached to words the other text does not contain cannot be contradicting it —
 * there is nothing there to contradict. That is the right idea, and the reason it is here rather
 * than in `src/` is that making it work needs a window width and a shared-token floor, both of
 * which can only be chosen by reading this corpus. It lives in the experiment so a larger corpus
 * can settle it later; see the module header of `src/services/contradiction.ts`.
 *
 * @param a - First text
 * @param b - Second text
 * @param width - Content tokens either side of a negation that count as its neighbourhood
 * @param floor - How many of those must be shared with the other text
 * @returns true when exactly one text negates something the two have in common
 */
export function scopedNegationMismatch(a: string, b: string, width: number, floor: number): boolean {
  const left = tokenize(a.toLowerCase().replace(/\b(\w+)n't\b/g, '$1 not'));
  const right = tokenize(b.toLowerCase().replace(/\b(\w+)n't\b/g, '$1 not'));
  const shared = new Set(left.filter((t) => !NEGATIONS.has(t) && right.includes(t)));

  const bearing = (tokens: string[]): number => {
    let found = 0;
    for (const [i, token] of tokens.entries()) {
      if (!NEGATIONS.has(token)) continue;
      const from = Math.max(0, i - width);
      const to = Math.min(tokens.length - 1, i + width);
      const window = tokens.slice(from, to + 1).filter((_, k) => from + k !== i);
      if (window.filter((t) => shared.has(t)).length >= floor) found++;
    }
    return found;
  };
  return (bearing(left) === 0) !== (bearing(right) === 0);
}

/** The rules compared, shipped one first. */
export const GUARDS: Array<{ name: string; guard: Guard; shipped: boolean }> = [
  { name: 'negation only (was shipped)', guard: negationMismatch, shipped: false },
  { name: 'preference inversion only', guard: preferenceInversion, shipped: false },
  { name: 'negation OR inversion', guard: contradicts, shipped: true },
  {
    name: 'scoped(3,1) OR inversion',
    guard: (a, b) => scopedNegationMismatch(a, b, 3, 1) || preferenceInversion(a, b),
    shipped: false,
  },
  {
    name: 'scoped(4,2) OR inversion',
    guard: (a, b) => scopedNegationMismatch(a, b, 4, 2) || preferenceInversion(a, b),
    shipped: false,
  },
];

/** The fixture memory a polarity case is written against. */
function memoryFor(fixtureId: string): string {
  const found = FIXTURE.find((m) => m.id === fixtureId);
  // A case naming a memory that no longer exists would silently score as a clean miss, so it
  // fails loudly instead — the same reason the model scorer in run.ts throws on an unseen text.
  if (!found) throw new Error(`polarity case refers to an unknown fixture memory: ${fixtureId}`);
  return found.content;
}

/** The 11 pool duplicates as (candidate, pool memory) texts. */
function poolDuplicates(): Array<{ candidate: string; existing: string }> {
  return Object.entries(DUPLICATE_OF).flatMap(([pairId, fixtureId]) => {
    const pair = DEDUP_PAIRS.find((p) => p.id === pairId);
    return pair ? [{ candidate: pair.b, existing: memoryFor(fixtureId) }] : [];
  });
}

/**
 * Score one guard on every labelled class.
 *
 * @param entry - The guard and its name
 * @returns Catch and cost counts
 */
export function evaluateGuard(entry: { name: string; guard: Guard; shipped: boolean }): GuardResult {
  const { guard } = entry;
  const against = (pick: (c: (typeof POLARITY)[number]) => string): number =>
    POLARITY.filter((c) => guard(pick(c), memoryFor(c.of))).length;

  return {
    name: entry.name,
    shipped: entry.shipped,
    reversalsCaught: against((c) => c.reversed),
    restatementsBlocked: against((c) => c.restated),
    oppositesCaught: DEDUP_PAIRS.filter((p) => p.tags.includes('opposite') && guard(p.a, p.b)).length,
    poolDuplicatesBlocked: poolDuplicates().filter((d) => guard(d.candidate, d.existing)).length,
    pairwiseDuplicatesBlocked: DEDUP_PAIRS.filter((p) => p.duplicate && guard(p.a, p.b)).length,
  };
}

/** How negating tokens are spread across the two polarity classes. */
export interface NegationBalance {
  reversedWithNegation: number;
  restatedWithNegation: number;
  cases: number;
}

/**
 * Count how many cases in each class contain a negation at all.
 *
 * This is the corpus's own soundness check, and it is reported rather than asserted. If
 * negations clustered in `reversed`, then "contains a negation" would BE the label and every
 * number in the guard table would be measuring the corpus instead of the guard.
 *
 * @returns Per-class counts of cases containing at least one negating token
 */
export function negationBalance(): NegationBalance {
  const hasNegation = (text: string): boolean =>
    tokenize(text.toLowerCase().replace(/\b(\w+)n't\b/g, '$1 not')).some((t) => NEGATIONS.has(t));
  return {
    cases: POLARITY.length,
    reversedWithNegation: POLARITY.filter((c) => hasNegation(c.reversed)).length,
    restatedWithNegation: POLARITY.filter((c) => hasNegation(c.restated)).length,
  };
}

/**
 * Check the polarity corpus accounts for the whole fixture.
 *
 * Every fixture memory must be either covered by a case or listed in `EXCLUDED` with a reason.
 * Without this, adding a memory to the fixture would quietly shrink the corpus and every guard
 * would appear to improve.
 *
 * @returns Problems found, empty when the corpus is sound
 */
export function polarityCorpusIsSound(): string[] {
  const problems: string[] = [];
  const covered = new Set([...POLARITY.map((c) => c.of), ...Object.keys(EXCLUDED)]);
  for (const memory of FIXTURE) {
    if (!covered.has(memory.id)) problems.push(`${memory.id} is neither reversed nor excluded`);
  }
  for (const id of Object.keys(EXCLUDED)) {
    if (!FIXTURE.some((m) => m.id === id)) problems.push(`${id} is excluded but not in the fixture`);
  }
  const seen = new Set<string>();
  for (const c of POLARITY) {
    if (seen.has(c.of)) problems.push(`${c.of} has more than one polarity case`);
    seen.add(c.of);
  }
  return problems;
}
