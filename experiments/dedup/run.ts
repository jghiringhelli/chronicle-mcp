#!/usr/bin/env tsx
/**
 * De-duplication experiment — is semantic similarity better than the shipped lexical one?
 *
 * Run:
 *   pnpm run experiment:dedup
 *   pnpm run experiment:dedup -- --update-baseline
 *
 * ## What is measured, and what is not
 *
 * `TeamPromotionService.promote` asks one question per candidate — *is this the same knowledge
 * the team already has?* — and answers it with a similarity function and a threshold. This
 * experiment measures **that decision function**, over 32 hand-labelled pairs. It does not drive
 * `promote` itself, because `promote` requires a configured Railway URL and pushes rows to a
 * shared database; wiring an experiment to that would make the measurement depend on a network
 * service and would write to a store a partner reads.
 *
 * So this answers "does cosine separate duplicates better than Jaccard", which is the question.
 * It does not prove the service wires the better one in correctly — that is what
 * `tests/unit/services/team-promotion-service.test.ts` is for.
 *
 * ## Why a threshold sweep, and not just the shipped thresholds
 *
 * The two methods ship with different constants — Jaccard at 0.50, cosine at 0.83 — chosen by
 * hand at different times, and comparing two methods at two arbitrary operating points measures
 * the choice of constants as much as the methods. The honest comparison is each method at its
 * own best threshold, so the sweep is the primary result and the shipped operating points are
 * reported beside it as "what the product actually does today".
 */

import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  contentSimilarity, PROMOTE_SIMILARITY_THRESHOLD, SEMANTIC_SIMILARITY_THRESHOLD,
} from '../../src/services/team-promotion-service.js';
import { contradicts } from '../../src/services/contradiction.js';
import { lexicalVector, cosine, LexicalVectorGateway } from '../../src/infrastructure/gateways/lexical-vector-gateway.js';
import { FastEmbedGateway } from '../../src/infrastructure/gateways/fastembed-gateway.js';
import { DEDUP_PAIRS, POSITIVES, type PairTag } from './pairs.js';
import { DUPLICATE_OF, NOVEL } from './pool.js';
import {
  GUARDS, evaluateGuard, negationBalance, polarityCorpusIsSound, type GuardResult,
} from './guards.js';
import { POLARITY } from './polarity.js';
import { FIXTURE } from '../lib/fixture.js';
import { f1 as harmonic, round4, fmt } from '../lib/metrics.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const BASELINE_FILE = join(HERE, '..', 'baseline-dedup.json');
const EVIDENCE_FILE = join(HERE, '..', '..', 'docs', 'evidence', 'dedup-experiment.json');

/** A drop larger than this in best-achievable F1 fails the run. */
const REGRESSION_THRESHOLD = 0.05;

/**
 * The thresholds the product actually ships with, **imported** rather than copied.
 *
 * They were literals here until 2026-11-10, and the moment ADR-028 changed them this table would
 * have reported numbers the product no longer used — the same two-copies drift that let a lint
 * error through a commit gate earlier the same day. Importing them means the "as shipped" row
 * cannot be wrong about what shipped.
 */
const SHIPPED = {
  lexical: PROMOTE_SIMILARITY_THRESHOLD,
  /** What the in-tree gateway declares, falling back to the service constant. */
  vector: new LexicalVectorGateway().dedupThreshold ?? SEMANTIC_SIMILARITY_THRESHOLD,
  /**
   * BGE-small's own floor, read off the gateway rather than restated.
   *
   * Constructing a FastEmbedGateway is free — it loads no model until something asks it to embed
   * — so this costs nothing even on a machine where fastembed is absent.
   */
  model: new FastEmbedGateway().dedupThreshold ?? SEMANTIC_SIMILARITY_THRESHOLD,
} as const;

const ALL_TAGS: PairTag[] = ['restatement', 'elaboration', 'related-but-distinct', 'opposite', 'unrelated'];

/** A similarity method under test. */
interface Method {
  name: string;
  /** Similarity in [0, 1] for two texts. */
  score(a: string, b: string): number;
  /** The threshold the product uses today, for the "as shipped" row. */
  shippedThreshold: number;
}

const METHODS: Method[] = [
  {
    name: 'lexical (Jaccard)',
    // The shipped function, imported rather than reimplemented so this row cannot flatter it.
    score: contentSimilarity,
    shippedThreshold: SHIPPED.lexical,
  },
  {
    name: 'semantic (cosine)',
    score: (a, b) => cosine(lexicalVector(a), lexicalVector(b)),
    shippedThreshold: SHIPPED.vector,
  },
  {
    // Cosine with the negation guard. Included because the first two rows show that the
    // ordering, not the threshold, is what breaks: contradictions outscore duplicates, so no
    // cut point is safe. This row measures whether changing the ordering fixes that.
    name: 'semantic + guard',
    score: (a, b) => (contradicts(a, b) ? 0 : cosine(lexicalVector(a), lexicalVector(b))),
    shippedThreshold: SHIPPED.vector,
  },
];

/** Confusion counts plus the derived rates. */
interface Outcome {
  threshold: number;
  truePositives: number;
  falsePositives: number;
  trueNegatives: number;
  falseNegatives: number;
  precision: number;
  recall: number;
  f1: number;
  /** Contradictory pairs wrongly merged. Reported separately: averaging hides it. */
  oppositesMerged: number;
}

/**
 * Score every pair with one method at one threshold.
 *
 * @param method - Similarity method
 * @param threshold - Similarity at or above which a pair is called a duplicate
 * @returns The confusion matrix and its derived rates
 */
function evaluate(method: Method, threshold: number): Outcome {
  let tp = 0;
  let fp = 0;
  let tn = 0;
  let fn = 0;
  let oppositesMerged = 0;

  for (const pair of DEDUP_PAIRS) {
    const predicted = method.score(pair.a, pair.b) >= threshold;
    if (predicted && pair.duplicate) tp++;
    else if (predicted && !pair.duplicate) {
      fp++;
      if (pair.tags.includes('opposite')) oppositesMerged++;
    } else if (!predicted && pair.duplicate) fn++;
    else tn++;
  }

  const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
  const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
  return {
    threshold,
    truePositives: tp, falsePositives: fp, trueNegatives: tn, falseNegatives: fn,
    precision, recall, f1: harmonic(precision, recall), oppositesMerged,
  };
}

/** Thresholds swept, 0.05 to 0.95 in steps of 0.05. */
const SWEEP = Array.from({ length: 19 }, (_, i) => round4((i + 1) * 0.05));

/**
 * Find the threshold that maximises F1 for a method.
 *
 * Ties go to the HIGHER threshold. A higher threshold merges fewer pairs, and in this
 * application a false positive is the worse error: it silently withholds a memory from the team,
 * which nobody observes, where a false negative merely leaves a near-duplicate in the pool,
 * which somebody can see and delete.
 *
 * @param method - Similarity method
 * @returns The best outcome and the full curve
 */
function best(method: Method): { best: Outcome; curve: Outcome[] } {
  const curve = SWEEP.map((t) => evaluate(method, t));
  let bestOutcome = curve[0]!;
  for (const o of curve) if (o.f1 >= bestOutcome.f1) bestOutcome = o;
  return { best: bestOutcome, curve };
}

/**
 * Per-class accuracy for one method at one threshold.
 *
 * @param method - Similarity method
 * @param threshold - Operating point
 * @returns Correct count and total per tag
 */
function byTag(method: Method, threshold: number): Record<string, { correct: number; total: number }> {
  const out: Record<string, { correct: number; total: number }> = {};
  for (const tag of ALL_TAGS) {
    const group = DEDUP_PAIRS.filter((p) => p.tags.includes(tag));
    const correct = group.filter((p) => (method.score(p.a, p.b) >= threshold) === p.duplicate).length;
    if (group.length) out[tag] = { correct, total: group.length };
  }
  return out;
}

const lines: string[] = [];
const say = (s = ''): void => { lines.push(s); console.log(s); };

/** A method with both of its operating points measured. */
type MethodResult = { method: Method; shipped: Outcome; best: Outcome; curve: Outcome[] };

/**
 * Print one confusion-matrix table.
 *
 * @param title - Table heading
 * @param results - Methods to report
 * @param pick - Which operating point of each method to show
 */
function printOutcomes(title: string, results: MethodResult[], pick: (r: MethodResult) => Outcome): void {
  say();
  say(title);
  say('-'.repeat(94));
  say('method               thr    P      R      F1     TP  FP  FN  TN   opposites merged');
  for (const r of results) {
    const o = pick(r);
    say(
      `${r.method.name.padEnd(20)} ${o.threshold.toFixed(2)}   ${fmt(o.precision)}   ${fmt(o.recall)}   ${fmt(o.f1)}   ` +
      `${String(o.truePositives).padStart(2)}  ${String(o.falsePositives).padStart(2)}  ` +
      `${String(o.falseNegatives).padStart(2)}  ${String(o.trueNegatives).padStart(2)}   ${o.oppositesMerged}`,
    );
  }
}

/**
 * Print the per-class breakdown, which is where the opposite class shows itself.
 *
 * @param results - Methods to report
 */
function printByTag(results: MethodResult[]): void {
  say();
  say("By pair class, at each method's best threshold — correct / total");
  say('-'.repeat(94));
  say(['pair class'.padEnd(22), ...results.map((r) => r.method.name.padEnd(20))].join(' '));
  for (const tag of ALL_TAGS) {
    const cells = results.map((r) => {
      const t = byTag(r.method, r.best.threshold)[tag];
      return (t ? `${t.correct}/${t.total}` : '—').padEnd(20);
    });
    say([tag.padEnd(22), ...cells].join(' '));
  }
}

/**
 * Print the full F1 curve, so the choice of threshold is auditable rather than asserted.
 *
 * @param results - Methods to report
 */
function printSweep(results: MethodResult[]): void {
  say();
  say('F1 across the threshold sweep');
  say('-'.repeat(94));
  say(['thr  '.padEnd(7), ...results.map((r) => r.method.name.padEnd(20))].join(' '));
  for (let i = 0; i < SWEEP.length; i++) {
    const cells = results.map((r) => fmt(r.curve[i]!.f1).padEnd(20));
    say([SWEEP[i]!.toFixed(2).padEnd(7), ...cells].join(' '));
  }
}

/**
 * Compare the headline numbers against the committed baseline.
 *
 * @param headline - Best-achievable F1 per method
 * @returns 0 when nothing regressed past the threshold, 1 when something did
 */
function compareBaseline(headline: Record<string, { bestF1: number; bestThreshold: number; shippedF1: number }>): number {
  if (!existsSync(BASELINE_FILE)) {
    say();
    say('No dedup baseline yet — run with --update-baseline to record one.');
    return 0;
  }
  const baseline = JSON.parse(readFileSync(BASELINE_FILE, 'utf8')) as { methods: Record<string, { bestF1: number }> };
  let code = 0;
  say();
  say('Against the committed baseline');
  say('-'.repeat(94));
  for (const [name, now] of Object.entries(headline)) {
    const was = baseline.methods[name];
    if (!was) { say(`  ${name.padEnd(20)} new method — nothing to compare`); continue; }
    const d = now.bestF1 - was.bestF1;
    say(`  ${name.padEnd(20)} best F1 ${fmt(was.bestF1)} → ${fmt(now.bestF1)} (${d >= 0 ? '+' : ''}${d.toFixed(3)})`);
    if (d < -REGRESSION_THRESHOLD) {
      say(`  REGRESSION: ${name} best F1 dropped ${Math.abs(d).toFixed(3)}`);
      code = 1;
    }
  }
  return code;
}

/**
 * Write the evidence artefact, and the baseline when asked for.
 *
 * Grouped into one argument rather than six positional ones: the lint gate caps a function at
 * five parameters, and six interchangeable record types in a row is exactly the signature where a
 * caller silently transposes two of them.
 *
 * @param run - Every artefact the run produced
 * @param updateBaseline - Whether to re-record the baseline
 */
interface DedupArtefacts {
  poolRows: Record<string, PoolOutcome[]>;
  sensitivity: Record<string, ReturnType<typeof poolSizeSensitivity>>;
  results: MethodResult[];
  headline: Record<string, { bestF1: number; bestThreshold: number; shippedF1: number }>;
  guardResults: GuardResult[];
}

function persist(run: DedupArtefacts, updateBaseline: boolean): void {
  const { poolRows, sensitivity, results, headline, guardResults } = run;
  const evidence = {
    experiment: 'dedup',
    contradictionGuards: {
      corpus: POLARITY.length,
      note: 'Every fixture memory stating a standing decision, reversed and restated. reversalsCaught is the safety number; the three blocked counts are what the guard costs.',
      negationBalance: negationBalance(),
      rules: guardResults,
    },
    poolScale: {
      pool: FIXTURE.length,
      duplicateCandidates: Object.keys(DUPLICATE_OF).length,
      novelCandidates: NOVEL.length,
      rows: poolRows,
      sizeSensitivity: sensitivity,
    },
    recordedAt: new Date().toISOString(),
    method: 'hand-labelled pairs; precision / recall / F1 for the duplicate class, swept over thresholds',
    platform: `${process.platform} node ${process.version}`,
    corpus: {
      pairs: DEDUP_PAIRS.length,
      duplicates: POSITIVES,
      byTag: Object.fromEntries(ALL_TAGS.map((t) => [t, DEDUP_PAIRS.filter((p) => p.tags.includes(t)).length])),
    },
    shippedThresholds: SHIPPED,
    methods: results.map((r) => ({
      name: r.method.name,
      shipped: r.shipped,
      best: r.best,
      byTagAtBest: byTag(r.method, r.best.threshold),
      curve: r.curve.map((o) => ({
        threshold: o.threshold, precision: round4(o.precision), recall: round4(o.recall),
        f1: round4(o.f1), falsePositives: o.falsePositives, oppositesMerged: o.oppositesMerged,
      })),
    })),
  };
  mkdirSync(dirname(EVIDENCE_FILE), { recursive: true });
  writeFileSync(EVIDENCE_FILE, `${JSON.stringify(evidence, null, 2)}
`);
  say();
  say('Evidence written to docs/evidence/dedup-experiment.json');

  if (!updateBaseline) return;
  writeFileSync(BASELINE_FILE, `${JSON.stringify({
    recordedAt: new Date().toISOString(),
    note:
      'Similarity-method rows: best achievable F1 over the threshold sweep, plus F1 at the shipped '
      + 'threshold. The "guard:" row reuses those two fields for different quantities, because the '
      + 'ratchet compares them the same way: bestF1 is the share of 48 reversed decisions the guard '
      + 'catches (must not fall), and shippedF1 is MINUS the share of 48 restatements it wrongly '
      + 'blocks, negated so a rise in false blocks also reads as a drop.',
    methods: headline,
  }, null, 2)}
`);
  say('Baseline updated at experiments/baseline-dedup.json');
}

/**
 * Build a synchronous similarity function backed by a real sentence-transformer.
 *
 * Every text the experiment will compare is embedded up front — both sides of all 32 pairs, the
 * 51 pool memories and the 12 novel candidates — so the method itself stays synchronous and
 * slots into the same `Method` shape as the other two. Embedding on demand would have made the
 * threshold sweep re-embed the same text nineteen times.
 *
 * @returns A scorer, or null when `fastembed` is not installed
 */
async function loadModelScorer(): Promise<((a: string, b: string) => number) | null> {
  const gw = new FastEmbedGateway();
  if (!(await gw.available())) return null;

  const texts = [
    ...DEDUP_PAIRS.flatMap((p) => [p.a, p.b]),
    ...FIXTURE.map((m) => m.content),
    ...NOVEL.map((n) => n.content),
  ];
  const unique = [...new Set(texts)];
  const vectors = await gw.generateBatch(unique);
  const byText = new Map(unique.map((t, i) => [t, vectors[i]!]));

  return (a: string, b: string): number => {
    const va = byText.get(a);
    const vb = byText.get(b);
    // A text the preload did not see would silently score 0 and look like a clean negative, so
    // it fails loudly instead.
    if (!va || !vb) throw new Error('model scorer asked about a text it was not given up front');
    return gw.cosineSimilarity(va, vb);
  };
}

// ── the pool-scale question ────────────────────────────────────────────────────────────────

/** How a method behaves against a whole pool rather than against one other memory. */
interface PoolOutcome {
  threshold: number;
  /** Of 11 candidates that restate a pool memory, how many were correctly suppressed. */
  duplicatesSuppressed: number;
  /** Of 12 candidates whose subject is absent from the pool, how many were wrongly suppressed. */
  novelSuppressed: number;
  /** Suppressed duplicates that were matched against the WRONG pool entry. */
  wrongTarget: number;
}

/**
 * Measure the decision the service actually makes: maximum similarity over the whole pool.
 *
 * This is the experiment that decides the threshold, and the pairwise sweep cannot stand in for
 * it. A maximum over N draws grows with N, so a threshold that maximises pairwise F1 can suppress
 * everything once the pool is large. `novelSuppressed` is the number that matters most: each one
 * is a memory the team would never receive, and nobody observes a memory that was not shared.
 *
 * @param score - The similarity function under test
 * @param guard - Whether to apply the negation guard, as the service does
 * @param threshold - Operating point
 * @returns The pool-scale outcome
 */
function evaluatePool(
  score: (a: string, b: string) => number,
  guard: boolean,
  threshold: number,
  poolSize = FIXTURE.length,
): PoolOutcome {
  const pool = FIXTURE.slice(0, poolSize).map((m) => ({ id: m.id, content: m.content }));

  const closest = (candidate: string): { id: string; score: number } | undefined => {
    let best: { id: string; score: number } | undefined;
    for (const p of pool) {
      if (guard && contradicts(candidate, p.content)) continue;
      const sc = score(candidate, p.content);
      if (!best || sc > best.score) best = { id: p.id, score: sc };
    }
    return best;
  };

  let duplicatesSuppressed = 0;
  let wrongTarget = 0;
  for (const [pairId, fixtureId] of Object.entries(DUPLICATE_OF)) {
    const pair = DEDUP_PAIRS.find((p) => p.id === pairId);
    if (!pair) continue;
    const match = closest(pair.b);
    if (match && match.score >= threshold) {
      duplicatesSuppressed++;
      if (match.id !== fixtureId) wrongTarget++;
    }
  }

  let novelSuppressed = 0;
  for (const n of NOVEL) {
    const match = closest(n.content);
    if (match && match.score >= threshold) novelSuppressed++;
  }

  return { threshold, duplicatesSuppressed, novelSuppressed, wrongTarget };
}

/**
 * How a chosen threshold behaves as the pool grows.
 *
 * The threshold chosen above is safe **against 51 memories**. A real pool holds thousands, and
 * the quantity being compared is a maximum over the pool, which grows with its size — so a
 * number that loses no memories here can start losing them later, and that would present as
 * "the team stopped receiving my memories" with nothing in any log.
 *
 * This cannot be measured past the corpus that exists. What it can do is show the direction: if
 * the count of wrongly suppressed memories is already climbing between 10 and 51 entries, the
 * threshold is a moving target and the product needs a rule rather than a constant.
 *
 * @param label - Method name
 * @param score - Similarity function
 * @param threshold - The proposed operating point
 * @param sizes - Pool sizes to try
 * @returns One row per pool size
 */
function poolSizeSensitivity(
  label: string,
  score: (a: string, b: string) => number,
  threshold: number,
  sizes: number[],
): Array<{ poolSize: number; duplicatesSuppressed: number; novelSuppressed: number }> {
  const rows = sizes.map((n) => {
    const o = evaluatePool(score, true, threshold, n);
    return { poolSize: n, duplicatesSuppressed: o.duplicatesSuppressed, novelSuppressed: o.novelSuppressed };
  });
  say();
  say(`${label} at ${threshold.toFixed(2)} — does the safe threshold hold as the pool grows?`);
  say('-'.repeat(94));
  say(`pool size   duplicates suppressed (of ${Object.keys(DUPLICATE_OF).length})   novel wrongly suppressed (of ${NOVEL.length})`);
  for (const r of rows) {
    say(`${String(r.poolSize).padStart(4)}        ${String(r.duplicatesSuppressed).padStart(2)}                          ${String(r.novelSuppressed).padStart(2)}`);
  }
  return rows;
}

/**
 * Print the pool-scale curve for one method.
 *
 * @param label - Method name
 * @param score - Similarity function
 * @param guard - Whether the negation guard is applied
 * @param floors - Thresholds to report
 * @returns The rows, for the evidence artefact
 */
function printPool(
  label: string,
  score: (a: string, b: string) => number,
  guard: boolean,
  floors: number[],
): PoolOutcome[] {
  const rows = floors.map((t) => evaluatePool(score, guard, t));
  say();
  say(`${label} — against the 51-memory pool, max similarity over the whole pool`);
  say('-'.repeat(94));
  say(`thr    duplicates suppressed (of ${Object.keys(DUPLICATE_OF).length})   novel wrongly suppressed (of ${NOVEL.length})   matched the wrong entry`);
  for (const r of rows) {
    say(`${r.threshold.toFixed(2)}   ${String(r.duplicatesSuppressed).padStart(2)}                          ` +
        `${String(r.novelSuppressed).padStart(2)}                               ${r.wrongTarget}`);
  }
  return rows;
}

/**
 * Print the contradiction-guard comparison, and the corpus soundness check that licenses it.
 *
 * The soundness check runs FIRST and aborts the section rather than printing a table nobody can
 * trust: if the corpus no longer covers the fixture, every guard's catch rate is measured
 * against a smaller denominator and would read as an improvement.
 *
 * @returns One row per candidate guard
 */
function reportGuards(): GuardResult[] {
  say();
  say('='.repeat(94));
  say(`CONTRADICTION GUARDS — ${POLARITY.length} fixture decisions, each reversed AND restated`);
  say('='.repeat(94));

  const problems = polarityCorpusIsSound();
  if (problems.length) {
    say('The polarity corpus does not account for the fixture, so the guard table is not reported:');
    for (const p of problems) say(`  ${p}`);
    return [];
  }

  const balance = negationBalance();
  say(`Corpus soundness: ${balance.reversedWithNegation}/${balance.cases} reversals and ` +
      `${balance.restatedWithNegation}/${balance.cases} restatements contain a negation.`);
  say('Close counts are the point — if negations clustered in one class, "contains a negation"');
  say('would be the label and the table below would measure the corpus, not the guard.');

  const rows = GUARDS.map(evaluateGuard);
  say();
  say(`reversals caught of ${POLARITY.length} is the safety number. The three blocked columns are the cost:`);
  say('a blocked restatement or duplicate leaves a near-duplicate somebody can see and delete.');
  say('-'.repeat(94));
  say('guard                        caught  restated  opposites  pool dups  pairwise dups');
  for (const r of rows) {
    say(
      `${(r.shipped ? `* ${r.name}` : `  ${r.name}`).padEnd(30)} ` +
      `${String(r.reversalsCaught).padStart(2)}/${POLARITY.length}   ` +
      `${String(r.restatementsBlocked).padStart(2)}/${POLARITY.length}     ` +
      `${r.oppositesCaught}/5        ` +
      `${String(r.poolDuplicatesBlocked).padStart(2)}/11      ` +
      `${String(r.pairwiseDuplicatesBlocked).padStart(2)}/11`,
    );
  }
  say();
  say('* is the rule the product ships. The scoped rows cut the duplicate cost further and are');
  say('NOT adopted: their window and floor were chosen by reading this corpus, and the gain is');
  say('entirely on the cheap error. See src/services/contradiction.ts.');
  return rows;
}

/**
 * The shipped guard's row, reduced to the two numbers worth ratcheting.
 *
 * Only the shipped rule is baselined. Baselining the alternatives would make the file fail
 * whenever somebody improved one of them, which is the opposite of a ratchet.
 *
 * @param rows - Every guard's result
 * @returns A baseline entry in the same shape the similarity methods use
 */
function guardHeadline(rows: GuardResult[]): { bestF1: number; bestThreshold: number; shippedF1: number } {
  const shipped = rows.find((r) => r.shipped);
  if (!shipped) return { bestF1: 0, bestThreshold: 0, shippedF1: 0 };
  // Reused shape, named honestly: `bestF1` carries the catch RATE, which is the number a
  // regression must not drop. `shippedF1` carries the false-block rate as a negative, so a rise
  // in false blocks also reads as a drop and trips the same comparison.
  return {
    bestF1: round4(shipped.reversalsCaught / POLARITY.length),
    bestThreshold: 0,
    shippedF1: round4(-shipped.restatementsBlocked / POLARITY.length),
  };
}

/** Thresholds the pool-scale section reports for Jaccard and the in-tree vectors. */
const POOL_FLOORS = [0.10, 0.15, 0.20, 0.25, 0.30, 0.40, 0.50];

/** Thresholds the pool-scale section reports for the model, whose scale is different. */
const MODEL_POOL_FLOORS = [0.55, 0.60, 0.65, 0.70, 0.75, 0.80, 0.83];

async function main(): Promise<number> {
  const updateBaseline = process.argv.slice(2).includes('--update-baseline');

  say();
  say('='.repeat(94));
  say(`DE-DUPLICATION EXPERIMENT — ${DEDUP_PAIRS.length} labelled pairs (${POSITIVES} duplicates, ${DEDUP_PAIRS.length - POSITIVES} not)`);
  say('='.repeat(94));

  const modelScore = await loadModelScorer();
  if (modelScore) {
    say();
    say('Model loaded: fastembed BGE-small-en-v1.5, 384 dimensions.');
    METHODS.push(
      { name: 'model (cosine)', score: modelScore, shippedThreshold: SHIPPED.model },
      {
        name: 'model + guard',
        score: (a, b) => (contradicts(a, b) ? 0 : modelScore(a, b)),
        shippedThreshold: SHIPPED.model,
      },
    );
  } else {
    say();
    say('fastembed is not installed, so the model rows are absent rather than zero.');
    say('It is a devDependency and outside the runtime tree (ADR-017): `pnpm add -D fastembed`.');
  }
  const results: MethodResult[] = METHODS.map((m) => ({ method: m, shipped: evaluate(m, m.shippedThreshold), ...best(m) }));

  printOutcomes('At the thresholds the product ships with today', results, (r) => r.shipped);
  printOutcomes("At each method's own best threshold — the fair comparison", results, (r) => r.best);
  printByTag(results);
  printSweep(results);

  say();
  say('='.repeat(94));
  say('THE DECISION THE SERVICE ACTUALLY MAKES — maximum similarity over the whole pool');
  say('='.repeat(94));
  say('A maximum over N draws grows with N, so a threshold tuned on pairs can suppress everything');
  say('against a real pool. "novel wrongly suppressed" is the number that decides the threshold:');
  say('each one is a memory the team never receives, and nobody can see a memory that was not sent.');
  const poolRows: Record<string, PoolOutcome[]> = {
    'lexical (Jaccard) + guard': printPool('lexical (Jaccard) + guard', contentSimilarity, true, POOL_FLOORS),
    'vector + guard': printPool('vector + guard', (a, b) => cosine(lexicalVector(a), lexicalVector(b)), true, POOL_FLOORS),
  };
  if (modelScore) {
    poolRows['model + guard'] = printPool('model + guard', modelScore, true, MODEL_POOL_FLOORS);
  }

  say();
  say('Sensitivity of the chosen thresholds to pool size');
  const sizes = [10, 25, FIXTURE.length];
  const sensitivity: Record<string, ReturnType<typeof poolSizeSensitivity>> = {
    'lexical (Jaccard) + guard': poolSizeSensitivity('lexical (Jaccard) + guard', contentSimilarity, 0.20, sizes),
    'vector + guard': poolSizeSensitivity('vector + guard', (a, b) => cosine(lexicalVector(a), lexicalVector(b)), 0.25, sizes),
  };
  if (modelScore) {
    sensitivity['model + guard'] = poolSizeSensitivity('model + guard', modelScore, 0.75, sizes);
  }

  const guardResults = reportGuards();

  const headline = Object.fromEntries(
    results.map((r) => [r.method.name, { bestF1: round4(r.best.f1), bestThreshold: r.best.threshold, shippedF1: round4(r.shipped.f1) }]),
  );
  headline['guard: negation OR inversion'] = guardHeadline(guardResults);

  const exitCode = compareBaseline(headline);
  persist({ poolRows, sensitivity, results, headline, guardResults }, updateBaseline);

  return exitCode;
}

process.exit(await main());
