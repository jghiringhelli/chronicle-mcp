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
import { FIXTURE, FIXTURE_IDS } from '../lib/fixture.js';
import { RECALL_CORPUS, type QueryTag } from './corpus.js';
import { aggregate, fmt, round4, type MetricSet, type Ranks } from '../lib/metrics.js';

// ── configuration ──────────────────────────────────────────────────────────────────────────

/** How many results a configuration may return. Metrics cut at 5; the extra room shows near misses. */
const RECALL_LIMIT = 10;

/** A drop larger than this in MRR or R@5 against the baseline fails the run. */
const REGRESSION_THRESHOLD = 0.05;

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
  /** Whether this is one of the three headline configurations or a diagnostic. */
  role: 'headline' | 'diagnostic';
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
  }
  return FIXTURE.length;
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

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const updateBaseline = argv.includes('--update-baseline');

  // Every labelled target must exist, or the experiment silently measures against a typo.
  const unknown = RECALL_CORPUS.flatMap((c) => c.mustFind).filter((id) => !FIXTURE_IDS.has(id));
  if (unknown.length) {
    console.error(`Corpus references ids absent from the fixture: ${unknown.join(', ')}`);
    return 1;
  }

  const dir = mkdtempSync(join(tmpdir(), 'chronicle-recall-'));
  const db = new Database(join(dir, 'experiment.db'));
  let exitCode = 0;

  try {
    applyConcurrencyPragmas(db);
    ensureSchema(db);
    const repo = new SqliteMemoryRepository(db);
    const seeded = seed(repo);

    const strategies = await buildStrategies(repo, db);

    const results: Array<{ strategy: Strategy; summary: ReturnType<typeof summarise> | null; obs: Observation[] }> = [];
    for (const strategy of strategies) {
      if (!strategy.available) {
        results.push({ strategy, summary: null, obs: [] });
        continue;
      }
      const obs = await measure(strategy);
      results.push({ strategy, summary: summarise(obs), obs });
    }

    printMatrix(results);
    printByTag(results);
    for (const r of results) if (r.summary) printFailures(r.strategy, r.obs);

    const headline: Record<string, { mrr: number; r5: number }> = {};
    for (const r of results) {
      if (r.summary) headline[r.strategy.name] = { mrr: round4(r.summary.overall.mrr), r5: round4(r.summary.overall.r5) };
    }

    const problems = checkBaseline(headline);
    if (problems.length) {
      say();
      say('REGRESSION');
      for (const p of problems) say(`  ${p}`);
      exitCode = 1;
    }

    // Evidence artefact. Written on every run, including a failing one: the record of a
    // regression is evidence too.
    const evidence = {
      experiment: 'recall',
      recordedAt: new Date().toISOString(),
      method: 'CodeSeeker tests/relevance — hand-labelled corpus, 1-based ranks, MRR / P@1 / P@3 / R@5 / F1@3',
      platform: `${process.platform} node ${process.version}`,
      fixture: { memories: seeded, queries: RECALL_CORPUS.length, recallLimit: RECALL_LIMIT },
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
        failures: r.obs.filter((o) => !o.passed).map((o) => ({ case: o.caseId, ranks: o.ranks, returned: o.returned, falsePositives: o.falsePositives })),
      })),
    };
    mkdirSync(dirname(EVIDENCE_FILE), { recursive: true });
    writeFileSync(EVIDENCE_FILE, `${JSON.stringify(evidence, null, 2)}\n`);
    say();
    say(`Evidence written to docs/evidence/recall-experiment.json`);

    if (updateBaseline) {
      const baseline: BaselineShape = {
        recordedAt: new Date().toISOString(),
        note: 'Headline MRR and R@5 per configuration. A later run failing against this file means recall quality moved.',
        configs: headline,
      };
      writeFileSync(BASELINE_FILE, `${JSON.stringify(baseline, null, 2)}\n`);
      say(`Baseline updated at experiments/baseline-recall.json`);
    }
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
async function buildStrategies(repo: MemoryRepository, db: Database.Database): Promise<Strategy[]> {
  const keyword: Strategy = {
    name: 'keyword',
    role: 'headline',
    available: true,
    async rank(query, limit) {
      return repo.recall({ query, limit }).map((r) => r.memory.id);
    },
  };

  // Filled in by the embedding work; see experiments/README.md § Provenance for why this file
  // was committed with these three unavailable.
  const notYet = (name: string, role: Strategy['role']): Strategy => ({
    name,
    role,
    available: false,
    unavailableReason: 'no embedding gateway wired into recall yet (ADR-014 §3)',
    async rank() { return []; },
  });

  void db;
  return [keyword, notYet('keyword-scored', 'diagnostic'), notYet('semantic', 'headline'), notYet('hybrid', 'headline')];
}

main()
  .then((code) => process.exit(code))
  .catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
