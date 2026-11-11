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

import { contentSimilarity } from '../../src/services/team-promotion-service.js';
import { negationMismatch } from '../../src/services/contradiction.js';
import { lexicalVector, cosine } from '../../src/infrastructure/gateways/lexical-vector-gateway.js';
import { DEDUP_PAIRS, POSITIVES, type PairTag } from './pairs.js';
import { f1 as harmonic, round4, fmt } from '../lib/metrics.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const BASELINE_FILE = join(HERE, '..', 'baseline-dedup.json');
const EVIDENCE_FILE = join(HERE, '..', '..', 'docs', 'evidence', 'dedup-experiment.json');

/** A drop larger than this in best-achievable F1 fails the run. */
const REGRESSION_THRESHOLD = 0.05;

/** The thresholds the product ships with, from `src/services/team-promotion-service.ts`. */
const SHIPPED = { lexical: 0.5, semantic: 0.83 } as const;

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
    shippedThreshold: SHIPPED.semantic,
  },
  {
    // Cosine with the negation guard. Included because the first two rows show that the
    // ordering, not the threshold, is what breaks: contradictions outscore duplicates, so no
    // cut point is safe. This row measures whether changing the ordering fixes that.
    name: 'semantic + guard',
    score: (a, b) => (negationMismatch(a, b) ? 0 : cosine(lexicalVector(a), lexicalVector(b))),
    shippedThreshold: SHIPPED.semantic,
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

function main(): number {
  const updateBaseline = process.argv.slice(2).includes('--update-baseline');

  say();
  say('='.repeat(94));
  say(`DE-DUPLICATION EXPERIMENT — ${DEDUP_PAIRS.length} labelled pairs (${POSITIVES} duplicates, ${DEDUP_PAIRS.length - POSITIVES} not)`);
  say('='.repeat(94));

  const results = METHODS.map((m) => ({ method: m, shipped: evaluate(m, m.shippedThreshold), ...best(m) }));

  say('At the thresholds the product ships with today');
  say('-'.repeat(94));
  say('method               thr    P      R      F1     TP  FP  FN  TN   opposites merged');
  for (const r of results) {
    const o = r.shipped;
    say(
      `${r.method.name.padEnd(20)} ${o.threshold.toFixed(2)}   ${fmt(o.precision)}   ${fmt(o.recall)}   ${fmt(o.f1)}   ` +
      `${String(o.truePositives).padStart(2)}  ${String(o.falsePositives).padStart(2)}  ${String(o.falseNegatives).padStart(2)}  ${String(o.trueNegatives).padStart(2)}   ${o.oppositesMerged}`,
    );
  }

  say();
  say('At each method\'s own best threshold — the fair comparison');
  say('-'.repeat(94));
  say('method               thr    P      R      F1     TP  FP  FN  TN   opposites merged');
  for (const r of results) {
    const o = r.best;
    say(
      `${r.method.name.padEnd(20)} ${o.threshold.toFixed(2)}   ${fmt(o.precision)}   ${fmt(o.recall)}   ${fmt(o.f1)}   ` +
      `${String(o.truePositives).padStart(2)}  ${String(o.falsePositives).padStart(2)}  ${String(o.falseNegatives).padStart(2)}  ${String(o.trueNegatives).padStart(2)}   ${o.oppositesMerged}`,
    );
  }

  say();
  say('By pair class, at each method\'s best threshold — correct / total');
  say('-'.repeat(94));
  say(['pair class'.padEnd(22), ...results.map((r) => r.method.name.padEnd(20))].join(' '));
  for (const tag of ALL_TAGS) {
    const cells = results.map((r) => {
      const t = byTag(r.method, r.best.threshold)[tag];
      return (t ? `${t.correct}/${t.total}` : '—').padEnd(20);
    });
    say([tag.padEnd(22), ...cells].join(' '));
  }

  say();
  say('F1 across the threshold sweep');
  say('-'.repeat(94));
  say(['thr  '.padEnd(7), ...results.map((r) => r.method.name.padEnd(20))].join(' '));
  for (let i = 0; i < SWEEP.length; i++) {
    const cells = results.map((r) => fmt(r.curve[i]!.f1).padEnd(20));
    say([SWEEP[i]!.toFixed(2).padEnd(7), ...cells].join(' '));
  }

  const headline = Object.fromEntries(
    results.map((r) => [r.method.name, { bestF1: round4(r.best.f1), bestThreshold: r.best.threshold, shippedF1: round4(r.shipped.f1) }]),
  );

  let exitCode = 0;
  if (existsSync(BASELINE_FILE)) {
    const baseline = JSON.parse(readFileSync(BASELINE_FILE, 'utf8')) as { methods: Record<string, { bestF1: number }> };
    say();
    say('Against the committed baseline');
    say('-'.repeat(94));
    for (const [name, now] of Object.entries(headline)) {
      const was = baseline.methods[name];
      if (!was) { say(`  ${name.padEnd(20)} new method — nothing to compare`); continue; }
      const d = now.bestF1 - was.bestF1;
      say(`  ${name.padEnd(20)} best F1 ${fmt(was.bestF1)} → ${fmt(now.bestF1)} (${d >= 0 ? '+' : ''}${d.toFixed(3)})`);
      if (d < -REGRESSION_THRESHOLD) { say(`  REGRESSION: ${name} best F1 dropped ${Math.abs(d).toFixed(3)}`); exitCode = 1; }
    }
  } else {
    say();
    say('No dedup baseline yet — run with --update-baseline to record one.');
  }

  const evidence = {
    experiment: 'dedup',
    recordedAt: new Date().toISOString(),
    method: 'hand-labelled pairs; precision / recall / F1 for the duplicate class, swept over thresholds',
    platform: `${process.platform} node ${process.version}`,
    corpus: { pairs: DEDUP_PAIRS.length, duplicates: POSITIVES, byTag: Object.fromEntries(ALL_TAGS.map((t) => [t, DEDUP_PAIRS.filter((p) => p.tags.includes(t)).length])) },
    shippedThresholds: SHIPPED,
    methods: results.map((r) => ({
      name: r.method.name,
      shipped: r.shipped,
      best: r.best,
      byTagAtBest: byTag(r.method, r.best.threshold),
      curve: r.curve.map((o) => ({ threshold: o.threshold, precision: round4(o.precision), recall: round4(o.recall), f1: round4(o.f1), falsePositives: o.falsePositives, oppositesMerged: o.oppositesMerged })),
    })),
  };
  mkdirSync(dirname(EVIDENCE_FILE), { recursive: true });
  writeFileSync(EVIDENCE_FILE, `${JSON.stringify(evidence, null, 2)}\n`);
  say();
  say('Evidence written to docs/evidence/dedup-experiment.json');

  if (updateBaseline) {
    writeFileSync(BASELINE_FILE, `${JSON.stringify({
      recordedAt: new Date().toISOString(),
      note: 'Best achievable F1 per similarity method over the threshold sweep, plus F1 at the threshold the product ships with.',
      methods: headline,
    }, null, 2)}\n`);
    say('Baseline updated at experiments/baseline-dedup.json');
  }

  return exitCode;
}

process.exit(main());
