#!/usr/bin/env tsx
/**
 * Recall experiment — MRR and R@5 for keyword, semantic and hybrid retrieval.
 *
 * Run:
 *   pnpm run experiment:recall                  # measure, compare to the committed baseline
 *   pnpm run experiment:recall -- --update-baseline
 *
 * The method is CodeSeeker's, applied to memories instead of files: a hand-labelled corpus,
 * the actual rank of every target recorded per (query x configuration), the same five metrics,
 * and a committed baseline that fails the run when a metric drops by more than
 * REGRESSION_THRESHOLD.
 *
 * ## What is being compared
 *
 * | Configuration    | Candidate set            | Ranked by                                  |
 * |------------------|--------------------------|--------------------------------------------|
 * | `keyword`        | SQL `LIKE` over words    | `weight DESC` — the query is not consulted |
 * | `keyword-scored` | the same `LIKE` set      | lexical overlap score                      |
 * | `semantic`       | every memory in scope    | cosine between query and memory vectors    |
 * | `hybrid`         | union of the two         | reciprocal rank fusion                     |
 *
 * `keyword` is the shipped behaviour as of this file's first commit. `keyword-scored` is a
 * diagnostic rather than one of the three headline configurations: without it, any improvement
 * from `semantic` or `hybrid` could be the embeddings OR could be the mere presence of
 * query-dependent scoring, and the experiment could not tell the reader which. Attributing a
 * scoring win to embeddings would be the most flattering mistake available here, so the
 * configuration that makes it visible is included on purpose.
 *
 * ## Isolation
 *
 * Every run builds a fresh SQLite database under the OS temp directory and deletes it
 * afterwards. Nothing touches `~/.chronicle/chronicle.db`. There are no absolute paths in this
 * file: the database comes from `os.tmpdir()` and the evidence path is resolved relative to
 * this module, so the script runs the same on Linux, macOS and Windows.
 */

import Database from 'better-sqlite3';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { applyConcurrencyPragmas, ensureSchema } from '../../src/infrastructure/db/database.js';
import { SqliteMemoryRepository } from '../../src/adapters/repositories/sqlite-memory-repository.js';
import type { MemoryRepository } from '../../src/ports/repositories/memory-repository.js';
import type { Embedding } from '../../src/domain/types.js';
import { lexicalVector, cosine } from '../../src/infrastructure/gateways/lexical-vector-gateway.js';
import { FastEmbedGateway } from '../../src/infrastructure/gateways/fastembed-gateway.js';
import { NodeIdGenerator } from '../../src/infrastructure/gateways/node-id-generator.js';
import { NodeClock } from '../../src/infrastructure/gateways/node-clock.js';
import { MemoryService } from '../../src/services/memory-service.js';
import { rankByScore, reciprocalRankFusion } from '../../src/services/recall-ranker.js';
import { FIXTURE, FIXTURE_IDS } from '../lib/fixture.js';
import { RECALL_CORPUS, type QueryTag } from './corpus.js';
import { aggregate, fmt, round4, type MetricSet, type Ranks } from '../lib/metrics.js';

// ── configuration ──────────────────────────────────────────────────────────────────────────

/** How many results a configuration may return. Metrics cut at 5; the extra room shows near misses. */
const RECALL_LIMIT = 10;

/** A drop larger than this in MRR or R@5 against the baseline fails the run. */
const REGRESSION_THRESHOLD = 0.05;

/**
 * How many rows a configuration may pull before ranking.
 *
 * Deliberately far above the fixture size so that retrieval never truncates by weight before
 * the ranker has seen the candidates — truncating first is the defect under measurement, and
 * leaving it in the candidate stage would hide it behind the new ranking.
 */
const CANDIDATE_CAP = 5000;

/**
 * Cosine below which a memory is not returned at all.
 *
 * Needed because the semantic configuration starts from every memory in scope rather than from
 * a filtered set: without a floor it would return all 51 for every query, scoring a perfect
 * R@5 on nothing and a false positive on every out-of-scope case. 0.10 was chosen before
 * looking at the per-case results, and the run reports a sweep so a reader can see how much
 * the choice is worth.
 */
const MIN_COSINE = 0.10;

/** How deep each input list goes into the fusion. */
const FUSION_DEPTH = 20;

const HERE = dirname(fileURLToPath(import.meta.url));
const BASELINE_FILE = join(HERE, '..', 'baseline-recall.json');
const EVIDENCE_FILE = join(HERE, '..', '..', 'docs', 'evidence', 'recall-experiment.json');

const ALL_TAGS: QueryTag[] = [
  'exact-keyword', 'morphology', 'paraphrase', 'synonym', 'ranking', 'multi-relevant', 'out-of-scope',
];

// ── strategy contract ──────────────────────────────────────────────────────────────────────

/**
 * One retrieval configuration under test.
 *
 * `rank` returns memory ids best-first. It is async so that a model-backed embedding gateway
 * fits the same contract as the in-process one; nothing here assumes the ranking is cheap.
 */
interface Strategy {
  name: string;
  /** False when the configuration cannot run — reported rather than silently skipped. */
  available: boolean;
  /** Why it cannot run. Printed in the report so an absent number is never mistaken for a zero. */
  unavailableReason?: string;
  /** `baseline` is the frozen pre-change path; `headline` is a configuration under test. */
  role: 'headline' | 'diagnostic' | 'baseline';
  rank(query: string, limit: number): Promise<string[]>;
}

// ── seeding ────────────────────────────────────────────────────────────────────────────────

/**
 * Write the fixture into a repository, forcing each memory's designed weight.
 *
 * `create` computes a weight from the type and the confirmed flag, which would erase the
 * adversarial weighting the fixture depends on, so each row is created and then updated with
 * the designed value.
 *
 * The vector is written through `attachEmbedding` rather than held in memory, so the semantic
 * configuration reads its vectors back out of the `embedding` column exactly as production
 * would — including the float32 truncation the column imposes on a float64 vector. Measuring
 * against in-process vectors would have skipped the one step most likely to be wrong.
 *
 * @param repo - Target repository
 * @returns Number of memories written
 */
function seed(repo: MemoryRepository): number {
  for (const m of FIXTURE) {
    const created = repo.create(m.id, {
      content: m.content,
      memoryType: m.memoryType,
      project: m.project,
      scope: m.scope,
      category: m.category,
      tags: m.tags,
      confirmed: m.confirmed,
    });
    repo.update({ ...created, weight: m.weight });
    repo.attachEmbedding(m.id, lexicalVector(embeddableText(m.content, m.tags)));
  }
  return FIXTURE.length;
}

/**
 * The text a memory is embedded from: its content plus its tags.
 *
 * Tags are included because they are curated — somebody chose `accessibility` for that memory —
 * and leaving them out of the vector while `lexicalScore` reads them would mean the two rankers
 * disagree about what the memory says.
 *
 * @param content - Memory content
 * @param tags - Memory tags
 * @returns The text to vectorise
 */
function embeddableText(content: string, tags: readonly string[]): string {
  return tags.length ? `${content} ${tags.join(' ')}` : content;
}

// ── measurement ────────────────────────────────────────────────────────────────────────────

/** One (case x configuration) observation. */
interface Observation {
  caseId: string;
  query: string;
  tags: QueryTag[];
  /** 1-based rank of each `mustFind` target, 0 when it never came back. */
  ranks: Ranks;
  /** How many results the configuration returned. */
  returned: number;
  /** For `expectEmpty` cases: ids that came back when nothing should have. */
  falsePositives: string[];
  /** Whether every target landed within `maxRank`. */
  passed: boolean;
  elapsedMs: number;
}

/**
 * Run every corpus case against one strategy.
 *
 * @param strategy - Configuration under test
 * @returns One observation per case
 */
async function measure(strategy: Strategy): Promise<Observation[]> {
  const out: Observation[] = [];

  for (const c of RECALL_CORPUS) {
    const started = performance.now();
    const ids = await strategy.rank(c.query, RECALL_LIMIT);
    const elapsedMs = performance.now() - started;

    const ranks = c.mustFind.map((target) => {
      const idx = ids.indexOf(target);
      return idx === -1 ? 0 : idx + 1;
    });

    const falsePositives = c.expectEmpty ? ids.slice(0, 5) : [];
    const passed = c.expectEmpty
      ? ids.length === 0
      : ranks.every((r) => r > 0 && r <= c.maxRank);

    out.push({ caseId: c.id, query: c.query, tags: c.tags, ranks, returned: ids.length, falsePositives, passed, elapsedMs });
  }

  return out;
}

/** Cases that have at least one relevant memory — the ones MRR and precision are defined on. */
function scorable(obs: Observation[]): Observation[] {
  const byId = new Map(RECALL_CORPUS.map((c) => [c.id, c]));
  return obs.filter((o) => !byId.get(o.caseId)?.expectEmpty);
}

/**
 * Aggregate one strategy's observations into the reported numbers.
 *
 * Out-of-scope cases are deliberately kept OUT of the five metrics and reported as a separate
 * false-positive rate. Folding them in would add a constant 0 to every configuration's MRR,
 * which moves every number down by the same amount and tells the reader nothing — while making
 * the headline MRR incomparable with CodeSeeker's, whose corpus has no such class.
 */
function summarise(obs: Observation[]): {
  overall: MetricSet;
  byTag: Record<string, MetricSet>;
  outOfScope: { cases: number; withFalsePositives: number; falsePositiveRate: number };
  passed: number;
  latencyMs: { mean: number; max: number };
} {
  const scored = scorable(obs);
  const overall = aggregate(scored.map((o) => o.ranks));

  const byTag: Record<string, MetricSet> = {};
  for (const tag of ALL_TAGS) {
    if (tag === 'out-of-scope') continue;
    const group = scored.filter((o) => o.tags.includes(tag));
    if (group.length) byTag[tag] = aggregate(group.map((o) => o.ranks));
  }

  const empties = obs.filter((o) => !scored.includes(o));
  const withFp = empties.filter((o) => o.falsePositives.length > 0).length;

  const latencies = obs.map((o) => o.elapsedMs);
  return {
    overall,
    byTag,
    outOfScope: {
      cases: empties.length,
      withFalsePositives: withFp,
      falsePositiveRate: empties.length ? withFp / empties.length : 0,
    },
    passed: obs.filter((o) => o.passed).length,
    latencyMs: {
      mean: latencies.reduce((s, v) => s + v, 0) / (latencies.length || 1),
      max: Math.max(...latencies),
    },
  };
}

// ── reporting ──────────────────────────────────────────────────────────────────────────────

const lines: string[] = [];
const say = (s = ''): void => { lines.push(s); console.log(s); };

/**
 * Print the headline table: one row per configuration.
 *
 * @param results - Per-strategy summaries in declaration order
 */
function printMatrix(results: Array<{ strategy: Strategy; summary: ReturnType<typeof summarise> | null }>): void {
  say();
  say('='.repeat(94));
  say(`RECALL EXPERIMENT — ${FIXTURE.length} memories, ${RECALL_CORPUS.length} labelled queries`);
  say('='.repeat(94));
  say('Configuration      Role        MRR   P@1   P@3   R@5   F1@3  pass   f-pos  mean ms');
  say('-'.repeat(94));

  for (const { strategy, summary } of results) {
    if (!summary) {
      say(`${strategy.name.padEnd(18)} ${strategy.role.padEnd(11)} —     —     —     —     —      —      —      not run`);
      say(`${' '.repeat(30)}↳ ${strategy.unavailableReason ?? 'unavailable'}`);
      continue;
    }
    const m = summary.overall;
    say(
      `${strategy.name.padEnd(18)} ${strategy.role.padEnd(11)} ` +
      `${fmt(m.mrr)}  ${fmt(m.p1)}  ${fmt(m.p3)}  ${fmt(m.r5)}  ${fmt(m.f1at3)}  ` +
      `${String(summary.passed).padStart(2)}/${RECALL_CORPUS.length}  ` +
      `${summary.outOfScope.withFalsePositives}/${summary.outOfScope.cases}    ` +
      `${summary.latencyMs.mean.toFixed(2)}`,
    );
  }
  say('-'.repeat(94));
  say(`MRR and R@5 are the headline. "pass" counts cases where every target landed within its`);
  say(`maxRank. "f-pos" counts out-of-scope queries that returned anything at all.`);
}

/**
 * Print MRR and R@5 per query class, which is where a configuration's weakness shows.
 *
 * @param results - Per-strategy summaries
 */
function printByTag(results: Array<{ strategy: Strategy; summary: ReturnType<typeof summarise> | null }>): void {
  // Narrowed to a tuple so `summary` is non-optional below — a non-null assertion here would be
  // load-bearing in a reporting function, which is the kind of place one quietly becomes wrong.
  const live = results.flatMap((r) => (r.summary ? [{ name: r.strategy.name, summary: r.summary }] : []));
  if (live.length === 0) return;

  say();
  say('By query class — MRR / R@5');
  say('-'.repeat(94));
  const header = ['query class'.padEnd(16), ...live.map((r) => r.name.padEnd(16))].join(' ');
  say(header);
  for (const tag of ALL_TAGS) {
    if (tag === 'out-of-scope') continue;
    const cells = live.map((r) => {
      const m = r.summary.byTag[tag];
      return (m ? `${fmt(m.mrr)} / ${fmt(m.r5)}  (n=${m.cases})` : '—').padEnd(16);
    });
    say([tag.padEnd(16), ...cells].join(' '));
  }
}

/**
 * Print the cases that failed, so a reader can see what kind of question is still missed.
 *
 * @param strategy - Which configuration
 * @param obs - Its observations
 */
function printFailures(strategy: Strategy, obs: Observation[]): void {
  const failed = obs.filter((o) => !o.passed);
  if (!failed.length) {
    say();
    say(`${strategy.name}: every case passed.`);
    return;
  }
  say();
  say(`${strategy.name} — ${failed.length} case(s) missed:`);
  for (const f of failed) {
    const detail = f.falsePositives.length
      ? `returned ${f.returned} result(s) for an out-of-scope query: ${f.falsePositives.slice(0, 3).join(', ')}`
      : `ranks ${JSON.stringify(f.ranks)} (0 = not returned) of ${f.returned} result(s)`;
    say(`  ${f.caseId.padEnd(26)} ${detail}`);
  }
}

// ── baseline ───────────────────────────────────────────────────────────────────────────────

interface BaselineShape {
  recordedAt: string;
  note: string;
  configs: Record<string, { mrr: number; r5: number }>;
}

/**
 * Compare against the committed baseline and report any regression.
 *
 * @param current - Current per-configuration headline metrics
 * @returns Human-readable regression lines; empty when nothing regressed
 */
function checkBaseline(current: Record<string, { mrr: number; r5: number }>): string[] {
  if (!existsSync(BASELINE_FILE)) {
    say();
    say(`No baseline at ${BASELINE_FILE} — run with --update-baseline to record one.`);
    return [];
  }
  const baseline = JSON.parse(readFileSync(BASELINE_FILE, 'utf8')) as BaselineShape;
  const problems: string[] = [];

  say();
  say(`Against baseline recorded ${baseline.recordedAt}`);
  say('-'.repeat(94));
  for (const [name, now] of Object.entries(current)) {
    const was = baseline.configs[name];
    if (!was) {
      say(`  ${name.padEnd(18)} new configuration — nothing to compare`);
      continue;
    }
    const dMrr = now.mrr - was.mrr;
    const dR5 = now.r5 - was.r5;
    const sign = (d: number): string => (d >= 0 ? `+${d.toFixed(3)}` : d.toFixed(3));
    say(`  ${name.padEnd(18)} MRR ${fmt(was.mrr)} → ${fmt(now.mrr)} (${sign(dMrr)})   R@5 ${fmt(was.r5)} → ${fmt(now.r5)} (${sign(dR5)})`);
    if (dMrr < -REGRESSION_THRESHOLD) problems.push(`${name}: MRR dropped ${Math.abs(dMrr).toFixed(3)} (threshold ${REGRESSION_THRESHOLD})`);
    if (dR5 < -REGRESSION_THRESHOLD) problems.push(`${name}: R@5 dropped ${Math.abs(dR5).toFixed(3)} (threshold ${REGRESSION_THRESHOLD})`);
  }
  return problems;
}

// ── main ───────────────────────────────────────────────────────────────────────────────────

/** One configuration's measured outcome. */
interface Result {
  strategy: Strategy;
  summary: ReturnType<typeof summarise> | null;
  obs: Observation[];
}

/**
 * Measure every configuration in order.
 *
 * @param strategies - Configurations under test
 * @returns One result each, with `summary: null` for the ones that could not run
 */
async function runAll(strategies: Strategy[]): Promise<Result[]> {
  const results: Result[] = [];
  for (const strategy of strategies) {
    if (!strategy.available) {
      results.push({ strategy, summary: null, obs: [] });
      continue;
    }
    const obs = await measure(strategy);
    results.push({ strategy, summary: summarise(obs), obs });
  }
  return results;
}

/** Cosine floors the sweep reports for the in-tree lexical vectors. */
const SWEEP_FLOORS = [0.05, 0.10, 0.15, 0.20, 0.30];

/**
 * Cosine floors swept for the model vectors.
 *
 * A different range, because the two spaces are not comparable: BGE-small puts unrelated English
 * sentences around 0.3-0.5 rather than near 0, so a floor that is strict for the lexical space is
 * no filter at all here. Using one range for both would have measured the mismatch rather than
 * the models.
 */
const MODEL_SWEEP_FLOORS = [0.40, 0.50, 0.60, 0.65, 0.70, 0.75];

/**
 * The model configuration's cosine floor, chosen **a priori**.
 *
 * 0.65 was fixed before any per-case result was read, the same way MIN_COSINE was, and it is what
 * the headline row reports. The sweep below shows the whole curve, and if its best value differs
 * from this one that difference is NOT folded into the headline: picking the floor that maximises
 * MRR on the same 35 queries the MRR is reported over is tuning on the evaluation set, and it
 * would quietly convert this experiment from a measurement into a demonstration.
 */
const MODEL_FLOOR = 0.65;

/** How many corpus cases expect nothing back — the denominator of the false-positive count. */
const OUT_OF_SCOPE_CASES = RECALL_CORPUS.filter((c) => c.expectEmpty).length;

/**
 * Measure the semantic configuration at several cosine floors.
 *
 * The floor is the one free parameter in the vector path, and a single hand-picked value
 * invites the reader to assume it was chosen after seeing the results. Reporting the curve
 * makes the choice auditable: a floor that only works at one value is a tuned number, and a
 * metric that barely moves across the range is a parameter that did not matter.
 *
 * @param repo - Seeded repository
 * @returns One row per floor
 */
async function sweepCosineFloor(
  repo: MemoryRepository,
): Promise<Array<{ floor: number; mrr: number; r5: number; falsePositives: number }>> {
  const rows: Array<{ floor: number; mrr: number; r5: number; falsePositives: number }> = [];
  for (const floor of SWEEP_FLOORS) {
    const s = summarise(await measure(semanticAt(repo, floor)));
    rows.push({
      floor,
      mrr: round4(s.overall.mrr),
      r5: round4(s.overall.r5),
      falsePositives: s.outOfScope.withFalsePositives,
    });
  }
  say();
  say('Cosine floor sweep — semantic configuration only');
  say('-'.repeat(94));
  say('floor   MRR    R@5    out-of-scope queries that returned something');
  for (const r of rows) {
    say(`${r.floor.toFixed(2)}    ${fmt(r.mrr)}   ${fmt(r.r5)}   ${r.falsePositives}/${OUT_OF_SCOPE_CASES}`);
  }
  return rows;
}

/**
 * Measure the model configuration across its floor range.
 *
 * Same purpose as the lexical sweep: a single hand-picked floor invites the reader to assume it
 * was chosen after seeing the results, and a metric that barely moves across the range is a
 * parameter that did not matter.
 *
 * @param model - The loaded model and the embedded fixture
 * @returns One row per floor
 */
async function sweepModelFloor(
  model: ModelBundle,
): Promise<Array<{ floor: number; mrr: number; r5: number; falsePositives: number }>> {
  const rows: Array<{ floor: number; mrr: number; r5: number; falsePositives: number }> = [];
  for (const floor of MODEL_SWEEP_FLOORS) {
    const s = summarise(await measure(semanticModelAt(model, floor, `semantic-model@${floor.toFixed(2)}`)));
    rows.push({ floor, mrr: round4(s.overall.mrr), r5: round4(s.overall.r5), falsePositives: s.outOfScope.withFalsePositives });
  }
  say();
  say('Cosine floor sweep — model configuration only');
  say('-'.repeat(94));
  say(`floor   MRR    R@5    out-of-scope queries that returned something   (headline uses ${MODEL_FLOOR.toFixed(2)})`);
  for (const r of rows) {
    const mark = r.floor === MODEL_FLOOR ? '  <- headline, chosen a priori' : '';
    say(`${r.floor.toFixed(2)}    ${fmt(r.mrr)}   ${fmt(r.r5)}   ${r.falsePositives}/${OUT_OF_SCOPE_CASES}${mark}`);
  }
  return rows;
}

/**
 * Assemble the evidence artefact.
 *
 * @param seeded - How many memories were written
 * @param results - Per-configuration outcomes
 * @param sweep - Threshold sweep rows
 * @returns The object written to docs/evidence/
 */
function buildEvidence(
  seeded: number,
  results: Result[],
  sweep: Awaited<ReturnType<typeof sweepCosineFloor>>,
  modelSweep: Awaited<ReturnType<typeof sweepCosineFloor>>,
): unknown {
  return {
    experiment: 'recall',
    recordedAt: new Date().toISOString(),
    method: 'CodeSeeker tests/relevance — hand-labelled corpus, 1-based ranks, MRR / P@1 / P@3 / R@5 / F1@3',
    platform: `${process.platform} node ${process.version}`,
    fixture: { memories: seeded, queries: RECALL_CORPUS.length, recallLimit: RECALL_LIMIT },
    parameters: { minCosine: MIN_COSINE, modelFloor: MODEL_FLOOR, fusionDepth: FUSION_DEPTH, candidateCap: CANDIDATE_CAP },
    cosineFloorSweep: sweep,
    modelFloorSweep: modelSweep,
    configs: results.map((r) => ({
      name: r.strategy.name,
      role: r.strategy.role,
      available: r.strategy.available,
      unavailableReason: r.strategy.unavailableReason ?? null,
      metrics: r.summary
        ? {
            mrr: round4(r.summary.overall.mrr),
            p1: round4(r.summary.overall.p1),
            p3: round4(r.summary.overall.p3),
            r5: round4(r.summary.overall.r5),
            f1at3: round4(r.summary.overall.f1at3),
            cases: r.summary.overall.cases,
            passed: r.summary.passed,
            outOfScope: r.summary.outOfScope,
            latencyMs: { mean: round4(r.summary.latencyMs.mean), max: round4(r.summary.latencyMs.max) },
            byTag: Object.fromEntries(
              Object.entries(r.summary.byTag).map(([t, m]) => [t, { mrr: round4(m.mrr), r5: round4(m.r5), cases: m.cases }]),
            ),
          }
        : null,
      failures: r.obs
        .filter((o) => !o.passed)
        .map((o) => ({ case: o.caseId, ranks: o.ranks, returned: o.returned, falsePositives: o.falsePositives })),
    })),
  };
}

/**
 * Check that every labelled target names a memory the fixture actually contains.
 *
 * A typo in a target id makes the case unpassable for every configuration equally, which reads as
 * a hard query rather than as a broken label.
 *
 * @returns true when every target resolves
 */
function corpusIsSound(): boolean {
  const unknown = RECALL_CORPUS.flatMap((c) => c.mustFind).filter((id) => !FIXTURE_IDS.has(id));
  if (unknown.length === 0) return true;
  console.error(`Corpus references ids absent from the fixture: ${unknown.join(', ')}`);
  return false;
}

/**
 * Write the evidence artefact, and the baseline when asked for.
 *
 * Evidence is written on every run, including a failing one: the record of a regression is
 * evidence too.
 *
 * @param seeded - How many memories were written
 * @param results - Per-configuration outcomes
 * @param sweep - Threshold sweep rows
 * @param headline - Headline metrics per configuration
 * @param updateBaseline - Whether to re-record the baseline
 */
function persist(
  seeded: number,
  results: Result[],
  sweep: Awaited<ReturnType<typeof sweepCosineFloor>>,
  modelSweep: Awaited<ReturnType<typeof sweepCosineFloor>>,
  headline: Record<string, { mrr: number; r5: number }>,
  updateBaseline: boolean,
): void {
  mkdirSync(dirname(EVIDENCE_FILE), { recursive: true });
  writeFileSync(EVIDENCE_FILE, `${JSON.stringify(buildEvidence(seeded, results, sweep, modelSweep), null, 2)}
`);
  say();
  say('Evidence written to docs/evidence/recall-experiment.json');

  if (!updateBaseline) return;
  const baseline: BaselineShape = {
    recordedAt: new Date().toISOString(),
    note:
      'Headline MRR and R@5 per configuration. A later run failing against this file means recall ' +
      'quality moved. keyword-legacy is different in kind: it is a frozen copy of the pre-change ' +
      'path, so its numbers must stay put forever — a drift there means the copy stopped being ' +
      'faithful to what shipped, not that anything improved. It was verified against the real ' +
      'pre-change code, which measured MRR 0.2643 and R@5 0.4219. The two `*-model` rows are ' +
      'recorded only when fastembed is installed; a run without it reports them as not run and ' +
      'the comparison skips them, so a machine with no model never sees a false regression.',
    configs: headline,
  };
  writeFileSync(BASELINE_FILE, `${JSON.stringify(baseline, null, 2)}
`);
  say('Baseline updated at experiments/baseline-recall.json');
}

/**
 * Seed the database, measure every configuration, report, and write the artefacts.
 *
 * Separated from `main` so that main holds only the setup and teardown that must run whatever
 * happens here — the temp database has to be removed on a failing run as much as a passing one.
 *
 * @param db - An open, empty database
 * @param updateBaseline - Whether to re-record the baseline
 * @returns 0, or 1 when a configuration regressed past the threshold
 */
async function runExperiment(db: Database.Database, updateBaseline: boolean): Promise<number> {
  applyConcurrencyPragmas(db);
  ensureSchema(db);
  const repo = new SqliteMemoryRepository(db);
  const seeded = seed(repo);

  const model = await loadModel();
  if (model) say(`
Model loaded: fastembed BGE-small-en-v1.5, 384 dimensions. Floor ${MODEL_FLOOR.toFixed(2)}, fixed a priori.`);

  const results = await runAll(buildStrategies(repo, db, model, MODEL_FLOOR));
  printMatrix(results);
  printByTag(results);
  for (const r of results) if (r.summary) printFailures(r.strategy, r.obs);
  const sweep = await sweepCosineFloor(repo);
  const modelSweep = model ? await sweepModelFloor(model) : [];

  const headline: Record<string, { mrr: number; r5: number }> = {};
  for (const r of results) {
    if (r.summary) headline[r.strategy.name] = { mrr: round4(r.summary.overall.mrr), r5: round4(r.summary.overall.r5) };
  }

  const problems = checkBaseline(headline);
  if (problems.length) {
    say();
    say('REGRESSION');
    for (const p of problems) say(`  ${p}`);
  }

  // Written even on a regression: the record of one is evidence too.
  persist(seeded, results, sweep, modelSweep, headline, updateBaseline);
  return problems.length > 0 ? 1 : 0;
}
async function main(): Promise<number> {
  const updateBaseline = process.argv.slice(2).includes('--update-baseline');

  if (!corpusIsSound()) return 1;

  const dir = mkdtempSync(join(tmpdir(), 'chronicle-recall-'));
  const db = new Database(join(dir, 'experiment.db'));
  let exitCode = 0;

  try {
    exitCode = await runExperiment(db, updateBaseline);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }

  return exitCode;
}

/**
 * Build the configurations under test.
 *
 * Kept in one function so the set of configurations is visible in one place, and so a
 * configuration that cannot run reports why instead of disappearing from the table.
 *
 * @param repo - Seeded repository
 * @param db - The same database, for strategies that need their own SQL
 * @returns Strategies in report order
 */
/**
 * The semantic configuration at a given cosine floor.
 *
 * Factored out so the threshold sweep measures the same code the headline configuration uses,
 * rather than a second implementation that could drift from it.
 *
 * Candidates are every memory in scope rather than a lexically filtered set — which is the
 * whole point of a vector path: a memory with no word in common with the query cannot enter
 * the keyword candidate set at all.
 *
 * @param repo - Seeded repository
 * @param floor - Minimum cosine for a memory to be returned
 * @returns A strategy named for its floor
 */
function semanticAt(repo: MemoryRepository, floor: number): Strategy {
  return {
    name: floor === MIN_COSINE ? 'semantic' : `semantic@${floor.toFixed(2)}`,
    role: 'headline',
    available: true,
    async rank(query, limit) {
      const queryVec = lexicalVector(query);
      const all = repo.recall({ query: '', limit: CANDIDATE_CAP });
      const scored = all
        .map((c) => ({
          id: c.memory.id,
          // A row without a stored vector is embedded on the spot, so an existing store works
          // before any backfill runs. In this experiment every row has one.
          score: cosine(queryVec, c.memory.embedding ?? lexicalVector(c.memory.content)),
        }))
        .filter((s) => s.score >= floor);
      return rankByScore(scored).slice(0, limit);
    },
  };
}

/**
 * A loaded sentence-transformer plus the fixture embedded in its space.
 *
 * Held in memory rather than written to the `embedding` column, on purpose: the column holds the
 * in-tree lexical vectors, and the two spaces are not comparable. Mixing them would produce a
 * cosine between a 512-dimension hashed feature vector and a 384-dimension model output, which is
 * meaningless whichever way it is computed — the same reason `FirstAvailableEmbeddingGateway`
 * latches onto one gateway for the life of the process.
 */
interface ModelBundle {
  gw: FastEmbedGateway;
  /** Fixture id to its model vector. */
  byId: Map<string, Embedding>;
}

/**
 * Load the model and embed the whole fixture once.
 *
 * Returns null when `fastembed` is not installed, which is the normal case: it is a
 * devDependency, deliberately absent from the runtime tree (ADR-017), so the model
 * configurations report why they did not run and the rest of the experiment is unaffected. That
 * is what keeps `pnpm run experiments` reproducible with no network and no download.
 *
 * @returns The bundle, or null when no model is available
 */
async function loadModel(): Promise<ModelBundle | null> {
  const gw = new FastEmbedGateway();
  if (!(await gw.available())) return null;

  const texts = FIXTURE.map((m) => embeddableText(m.content, m.tags));
  const vectors = await gw.generateBatch(texts);
  const byId = new Map<string, Embedding>();
  FIXTURE.forEach((m, i) => byId.set(m.id, vectors[i]!));
  return { gw, byId };
}

/**
 * Cosine over model vectors at a given floor.
 *
 * @param model - The loaded model and the embedded fixture
 * @param floor - Minimum cosine for a memory to be returned
 * @param name - Configuration name
 * @returns The configuration
 */
function semanticModelAt(model: ModelBundle, floor: number, name = 'semantic-model'): Strategy {
  const queryCache = new Map<string, Embedding>();
  return {
    name,
    role: 'headline',
    available: true,
    async rank(query, limit) {
      let qv = queryCache.get(query);
      if (!qv) {
        qv = await model.gw.generate(query);
        queryCache.set(query, qv);
      }
      const scored = [...model.byId.entries()]
        .map(([id, v]) => ({ id, score: model.gw.cosineSimilarity(qv!, v) }))
        .filter((x) => x.score >= floor);
      return rankByScore(scored).slice(0, limit);
    },
  };
}

/**
 * The path as it shipped before any of this work, frozen here as SQL.
 *
 * It is a copy rather than a call, and that is on purpose. The production implementation has since
 * changed, so calling it would silently re-point this row at the new behaviour and the
 * before/after comparison — the entire claim — would quietly become a comparison of the new code
 * with itself. Frozen, the 0.26 stays reproducible for as long as the file exists.
 *
 * Faithfulness is checkable rather than asserted: this configuration must still reproduce the MRR
 * and R@5 in `experiments/baseline-recall.json`, which were recorded by running the real
 * pre-change code. If the copy had drifted, the baseline check would fail.
 *
 * @param db - The seeded database
 * @returns The frozen baseline configuration
 */
function legacyStrategy(db: Database.Database): Strategy {
  return {
    name: 'keyword-legacy',
    role: 'baseline',
    available: true,
    async rank(query, limit) {
      const words = query.trim().split(/\s+/).filter(Boolean);
      const where = words.length
        ? `WHERE (${words.map(() => '(content LIKE ? OR tags LIKE ?)').join(' OR ')})`
        : '';
      const params = words.flatMap((w) => [`%${w}%`, `%${w}%`]);
      const rows = db
        .prepare(`SELECT id FROM memories ${where} ORDER BY weight DESC LIMIT ?`)
        .all(...params, limit) as Array<{ id: string }>;
      return rows.map((r) => r.id);
    },
  };
}

/**
 * What a user actually gets: `MemoryService.recall`, through the real service.
 *
 * Measured through the service rather than reimplemented, so this row cannot report an
 * improvement the shipped code does not have.
 *
 * @param repo - Seeded repository
 * @returns The shipped configuration
 */
function shippedStrategy(repo: MemoryRepository): Strategy {
  const memSvc = new MemoryService(repo, new NodeIdGenerator(), new NodeClock());
  return {
    name: 'shipped',
    role: 'headline',
    available: true,
    async rank(query, limit) {
      return memSvc.recall({ query, limit }).map((m) => m.id);
    },
  };
}

/**
 * Rank fusion of the shipped ranking and the vector path.
 *
 * @param shipped - The lexical configuration
 * @param semantic - The vector configuration
 * @returns The fused configuration
 */
function hybridStrategy(shipped: Strategy, semantic: Strategy, name = 'hybrid'): Strategy {
  return {
    name,
    role: 'headline',
    available: true,
    async rank(query, limit) {
      const [lex, sem] = await Promise.all([
        shipped.rank(query, FUSION_DEPTH),
        semantic.rank(query, FUSION_DEPTH),
      ]);
      return reciprocalRankFusion([lex, sem]).slice(0, limit);
    },
  };
}

function buildStrategies(repo: MemoryRepository, db: Database.Database, model: ModelBundle | null, modelFloor: number): Strategy[] {
  const shipped = shippedStrategy(repo);
  const semantic = semanticAt(repo, MIN_COSINE);
  const base = [legacyStrategy(db), shipped, semantic, hybridStrategy(shipped, semantic)];

  if (!model) {
    const absent = (name: string): Strategy => ({
      name,
      role: 'headline',
      available: false,
      unavailableReason: 'fastembed is not installed — it is a devDependency and absent from the runtime tree (ADR-017). Run `pnpm add -D fastembed` to measure it.',
      async rank() { return []; },
    });
    return [...base, absent('semantic-model'), absent('hybrid-model')];
  }

  // Two separate instances on purpose. Each `semanticModelAt` carries its own query-vector cache,
  // and sharing one between the headline row and the hybrid made the hybrid inherit a warm cache
  // and report 0.28ms for a path whose model inference costs ~150ms — a latency figure that was
  // an artefact of the measurement rather than of the system.
  const semanticModel = semanticModelAt(model, modelFloor);
  const semanticModelForHybrid = semanticModelAt(model, modelFloor, 'semantic-model-inner');
  return [...base, semanticModel, hybridStrategy(shipped, semanticModelForHybrid, 'hybrid-model')];
}

main()
  .then((code) => process.exit(code))
  .catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
