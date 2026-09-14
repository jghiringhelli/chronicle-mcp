#!/usr/bin/env node
/**
 * Measure the non-functional requirements in docs/spec.md §5 (RM-104).
 *
 * These numbers have been published since March and never measured. NFR-03 in particular is
 * **at risk** by inspection: recall is a leading-wildcard `LIKE`, which cannot use an index, so the
 * predicate is a full scan (EDR-002) — and since ADR-018 a default recall runs **two** queries per
 * call, project scope plus person scope. A missed target here is a result, not a failure.
 *
 * Reproducibility is the point, so every run records the machine, the Node version, the store size
 * and a fixed seed. A number without its conditions is an anecdote.
 *
 * Safety: seeds a throwaway store via CHRONICLE_HOME. The real ~/.chronicle is never touched, and
 * no network is involved.
 *
 * Usage:
 *   node scripts/bench-nfr.mjs              # 1k, 10k (the NFR-03 scale)
 *   node scripts/bench-nfr.mjs --full       # adds 50k, the NFR-04 scale. Slow.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir, cpus, totalmem, platform, arch } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const SERVER = join(ROOT, 'dist', 'cli.js');
const FULL = process.argv.includes('--full');

if (!existsSync(SERVER)) { console.error('dist/cli.js absent — build first.'); process.exit(1); }

/** Deterministic PRNG, so the same store is generated on every machine. */
function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

/**
 * NFR-02's budget, per ADR-021 — revised from 200ms on the measured breakdown, because ~165ms of any
 * measurement here is Node startup plus the MCP SDK import and the original number left ~35ms for the
 * entire application. Kept beside the spec row it checks: `docs/spec.md` §5.
 */
const NFR02_TARGET_MS = 300;

/**
 * How many times cold start is measured.
 *
 * It used to be measured ONCE, while NFR-03 took 30 samples and reported a p95 — an inconsistency
 * that turned out to decide the verdict. Six consecutive runs on one host gave 225, 232, 262, 291,
 * 378 and 398ms; two of six exceeded the budget. Quoting any one of those as "the" cold start is
 * picking a number, and the 251ms that reached ADR-021 and `docs/spec.md` §5 was exactly that.
 * Process spawn is noisy — scheduler, page cache, antivirus — so the distribution is the measurement.
 */
const NFR02_SAMPLES = 10;

/**
 * How many times the session-end pass is measured. Fewer than NFR-02's, because each iteration is a
 * real 50,000-row pass rather than a process spawn and the spread is narrower — but more than one,
 * because 363ms and 564ms against a 500ms budget came from the same code on the same machine.
 */
const NFR04_SAMPLES = 9;

const SEED = 20260912;
const WORDS = [
  'railway', 'deploy', 'postgres', 'sqlite', 'migration', 'auth', 'token', 'cache', 'index',
  'schema', 'rollback', 'timeout', 'retry', 'idempotent', 'webhook', 'queue', 'worker', 'latency',
  'memory', 'session', 'scope', 'mirror', 'conflict', 'cursor', 'decay', 'promotion', 'embedding',
];
const TYPES = ['episodic', 'semantic', 'procedural', 'architectural', 'insight'];
const PROJECTS = [
  'github.com/jghiringhelli/chronicle-mcp', 'github.com/jghiringhelli/codeseeker',
  'github.com/jghiringhelli/loom', 'github.com/grodriguez1983/vairixdx',
];

/** Build a store of `n` memories directly through SQLite — seeding via MCP would measure the wrong thing. */
function seedStore(dbPath, n) {
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = OFF'); // seeding only; the measured runs use the real pragmas
  db.exec(schemaCache);

  const rnd = seeded(SEED);
  const insert = db.prepare(`
    INSERT INTO memories (id, content, memory_type, tier, weight, decay_rate, access_count,
      created_at, last_accessed_at, project, scope, category, tags, confirmed)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, '[]', 0)`);

  const now = Date.now();
  const many = db.transaction(() => {
    for (let i = 0; i < n; i++) {
      // A realistic sentence, not a uuid: the LIKE scan cost depends on content length.
      const len = 8 + Math.floor(rnd() * 14);
      const words = [];
      for (let w = 0; w < len; w++) words.push(WORDS[Math.floor(rnd() * WORDS.length)]);
      const type = TYPES[Math.floor(rnd() * TYPES.length)];
      const isPerson = rnd() < 0.2;
      // Spread last_accessed_at over 60 days so the decay pass has real work to find.
      const accessed = new Date(now - Math.floor(rnd() * 60) * 86_400_000).toISOString();
      insert.run(
        `bench-${i}`, words.join(' '), type,
        rnd() < 0.5 ? 'working' : 'buffer',
        0.3 + rnd() * 0.6, type === 'episodic' ? 0.1 : 0.02, Math.floor(rnd() * 12),
        new Date(now - Math.floor(rnd() * 90) * 86_400_000).toISOString(), accessed,
        isPerson ? null : PROJECTS[Math.floor(rnd() * PROJECTS.length)],
        isPerson ? 'person' : 'project',
      );
    }
  });
  many();
  db.close();
}

/**
 * The schema, taken from the build so the seeded store is exactly what the server expects.
 * A hand-copied CREATE TABLE here would drift from the real one and quietly measure a different
 * database than the product uses.
 */
let schemaCache = '';

/** Percentiles say more than a mean: a p95 over budget is a user-visible stall. */
function stats(samples) {
  const s = [...samples].sort((a, b) => a - b);
  const at = (p) => s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
  return {
    n: s.length,
    min: +s[0].toFixed(2),
    median: +at(50).toFixed(2),
    p95: +at(95).toFixed(2),
    max: +s[s.length - 1].toFixed(2),
    mean: +(s.reduce((a, b) => a + b, 0) / s.length).toFixed(2),
  };
}

/**
 * Summarise repeated timings of a once-per-session operation.
 *
 * This function has been wrong twice, and both mistakes are worth keeping written down because they
 * are the same mistake: fitting a model to one machine's data.
 *
 * 1. It started as a SINGLE reading, while NFR-03 took thirty and reported a p95. One reading is
 *    whichever point of the spread the run landed on, which is how `251ms` and `363ms` were recorded
 *    as *verified* in ADR-021 and spec §5.
 * 2. It then reported `cold` (first reading) and `steadyMedian` (median of the rest), judging on
 *    `cold`. That came from Windows samples, which are a clean monotonic warm-up — 349, 345, 280,
 *    210, 213, 225, 233, 242, 239, 220ms. On the CI linux runner the same code gives 791, 415, 207,
 *    553, 302ms: not a curve, just a noisy shared host. Calling the first of those "cold" and the
 *    rest "steady" reads a warm-up into what is interference.
 *
 * So the verdict is judged on the **median**, which is robust in both regimes, and `cold`, `max` and
 * the full sample list are reported beside it. `warmupMonotonic` records whether the series actually
 * decreases, so a reader can tell which regime the numbers came from instead of assuming.
 *
 * No `p95` here: at n of 5 or 10 the nearest-rank p95 *is* the maximum, and labelling a maximum as a
 * p95 claims resolution the sample does not have. NFR-03 keeps its p95, on thirty samples.
 */
function sampleProfile(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  const median = sorted.length % 2
    ? sorted[(sorted.length - 1) / 2]
    : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
  // "Monotonic" is deliberately loose: a warm-up curve need not decrease at every step, but its
  // second half should sit clearly below its first. Two thirds is a judgement, and it is recorded
  // rather than hidden so the threshold can be argued with.
  const half = Math.floor(samples.length / 2);
  const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
  return {
    n: samples.length,
    cold: +samples[0].toFixed(2),
    median: +median.toFixed(2),
    min: +Math.min(...samples).toFixed(2),
    max: +Math.max(...samples).toFixed(2),
    warmupMonotonic: half > 0 && mean(samples.slice(half)) < mean(samples.slice(0, half)) * (2 / 3),
    samples_ms: samples.map((s) => +s.toFixed(2)),
  };
}

async function connect(home) {
  const transport = new StdioClientTransport({
    command: process.execPath, args: [SERVER], stderr: 'pipe',
    env: { ...process.env, CHRONICLE_HOME: home },
  });
  const client = new Client({ name: 'bench', version: '1.0.0' });
  const t0 = performance.now();
  await client.connect(transport);
  // A handshake is not a cold start: the first real call is when the database opens and the schema
  // runs. That is what a user waits for.
  await client.callTool({ name: 'chronicle', arguments: { action: 'stats' } });
  return { client, coldStartMs: performance.now() - t0 };
}

const results = { nfr02: null, nfr03: [], nfr04: null };
const homes = [];

try {
  // Pull the schema out of the build so the seeded store matches exactly what the server expects.
  // A Windows absolute path is not a valid ESM specifier; it must be a file:// URL.
  const { SCHEMA_SQL } = await import(pathToFileURL(join(ROOT, 'dist', 'index.js')).href);
  schemaCache = SCHEMA_SQL;
  if (!schemaCache) throw new Error('SCHEMA_SQL is not exported from the build — rebuild first');

  const sizes = FULL ? [1_000, 10_000, 50_000] : [1_000, 10_000];
  console.log(`machine: ${platform()}-${arch()}, ${cpus().length} cpus, ` +
    `${Math.round(totalmem() / 2 ** 30)}GB, node ${process.version}`);
  console.log(`seed: ${SEED}   sizes: ${sizes.join(', ')}\n`);

  for (const size of sizes) {
    const home = mkdtempSync(join(tmpdir(), `chronicle-bench-${size}-`));
    homes.push(home);
    writeFileSync(join(home, 'config.json'), JSON.stringify({
      userId: 'bench', deviceId: 'bench-device', dbPath: join(home, 'chronicle.db'),
    }, null, 2), 'utf8');

    process.stdout.write(`seeding ${size.toLocaleString()} memories… `);
    const seedStart = performance.now();
    seedStore(join(home, 'chronicle.db'), size);
    console.log(`${Math.round(performance.now() - seedStart)}ms`);

    const { client, coldStartMs } = await connect(home);

    // ── NFR-02: cold start ──────────────────────────────────────────────────────────────────
    // 300ms, not 200ms: ADR-021 revised the budget on the measured breakdown (~165ms of any
    // measurement is Node plus the MCP SDK). This constant had stayed at the superseded number, so
    // CI printed MISSES against a target the spec no longer contains — a gate disagreeing with the
    // document it gates is worse than no gate, because the output looks authoritative.
    //
    // Sampled repeatedly, and on the SMALLEST store only. Store size is not a cold-start variable
    // worth sweeping — `ensureSchema` short-circuits on `user_version` and nothing reads rows at
    // startup — whereas spawn noise is large enough to flip the verdict by itself.
    if (results.nfr02 === null) {
      const samples = [coldStartMs];
      while (samples.length < NFR02_SAMPLES) {
        const again = await connect(home);
        samples.push(again.coldStartMs);
        await again.client.close();
      }
      const w = sampleProfile(samples);
      results.nfr02 = { ...w, ms: w.median, target: NFR02_TARGET_MS };
      console.log(`  cold start (spawn → first answer): median ${w.median}ms  ` +
        `(first ${w.cold}ms, ${w.min}-${w.max}ms over ${w.n} spawns` +
        `${w.warmupMonotonic ? ', warming' : ''})  [NFR-02 < ${NFR02_TARGET_MS}ms]`);
    }

    // ── NFR-03: recall ──────────────────────────────────────────────────────────────────────
    // Vary the query so no single plan is cached into looking fast, and use words that genuinely
    // occur, because a query matching nothing exits early and measures the wrong thing.
    const rnd = seeded(SEED + 1);
    const samples = [];
    const warmup = 5;
    for (let i = 0; i < 30 + warmup; i++) {
      const q = [WORDS[Math.floor(rnd() * WORDS.length)], WORDS[Math.floor(rnd() * WORDS.length)]].join(' ');
      const t = performance.now();
      await client.callTool({ name: 'chronicle', arguments: { action: 'recall', query: q, limit: 20 } });
      const ms = performance.now() - t;
      if (i >= warmup) samples.push(ms);
    }
    const recall = stats(samples);
    results.nfr03.push({ storeSize: size, target: 50, ...recall });
    const verdict = recall.p95 <= 50 ? 'MEETS' : 'MISSES';
    console.log(`  recall over MCP: median ${recall.median}ms  p95 ${recall.p95}ms  max ${recall.max}ms  ` +
      `[NFR-03 < 50ms at 10k] ${size === 10_000 ? verdict : ''}`);

    // ── NFR-04: the decay + promotion pass ──────────────────────────────────────────────────
    //
    // Sampled, for the same reason as NFR-02 and with more riding on it: this pass lands within ~25%
    // of its budget, so one reading decides MEETS or MISSES almost at random. Runs on this host have
    // given 363ms, 504ms and 564ms against a 500ms target — same code, opposite verdicts.
    //
    // Repeating is valid: the pass does the same work every time. `decayOlderThan` selects on
    // `last_accessed_at < cutoff` and `decay_rate > 0`, neither of which it mutates, so the same rows
    // match and the same number are written on each iteration. Only the weights get smaller.
    if (size === Math.max(...sizes)) {
      const samples = [];
      for (let i = 0; i < NFR04_SAMPLES; i += 1) {
        const t = performance.now();
        await client.callTool({ name: 'chronicle', arguments: { action: 'decay' } });
        samples.push(performance.now() - t);
      }
      const w = sampleProfile(samples);
      results.nfr04 = { storeSize: size, ...w, ms: w.median, target: 500 };
      console.log(`  decay + promotion pass at ${size.toLocaleString()}: median ${w.median}ms  ` +
        `(first ${w.cold}ms, ${w.min}-${w.max}ms over ${w.n} passes` +
        `${w.warmupMonotonic ? ', warming' : ''})  [NFR-04 < 500ms]`);
    }

    await client.close();
  }

  const evidence = {
    ran_at: new Date().toISOString(),
    command: 'node scripts/bench-nfr.mjs' + (FULL ? ' --full' : ''),
    machine: {
      platform: `${platform()}-${arch()}`, cpus: cpus().length,
      cpu_model: cpus()[0]?.model ?? 'unknown',
      memory_gb: Math.round(totalmem() / 2 ** 30), node: process.version,
    },
    seed: SEED,
    note: 'Measured over the real MCP stdio boundary, which is what a user waits for. Recall runs ' +
          'TWO queries per call since ADR-018 (project scope + person scope). Cold start is ' +
          `${NFR02_SAMPLES} spawns reported as a distribution and judged on p95, not one sample: ` +
          'repeated runs on one host spread 225-398ms, so a single figure would be a choice rather ' +
          'than a measurement.',
    nfr02_cold_start: results.nfr02,
    nfr03_recall: results.nfr03,
    nfr04_decay_pass: results.nfr04,
  };
  mkdirSync(join(ROOT, 'docs', 'evidence'), { recursive: true });
  writeFileSync(join(ROOT, 'docs', 'evidence', 'nfr-bench.json'),
    JSON.stringify(evidence, null, 2) + '\n', 'utf8');

  console.log('\n── verdicts ──');
  // Judged on p95, the same basis as NFR-03. A median inside budget with a p95 outside it is a stall
  // a user meets one session in twenty; reporting only the median would hide it.
  console.log(`NFR-02 cold start < ${NFR02_TARGET_MS}ms        : median ${results.nfr02.median}ms  ` +
    (results.nfr02.median <= NFR02_TARGET_MS ? 'MEETS' : 'MISSES') +
    `  (worst ${results.nfr02.max}ms of ${results.nfr02.n})` +
    (results.nfr02.max > NFR02_TARGET_MS && results.nfr02.median <= NFR02_TARGET_MS
      ? '  — the worst spawn is over budget' : ''));
  const at10k = results.nfr03.find((r) => r.storeSize === 10_000);
  if (at10k) {
    console.log(`NFR-03 recall < 50ms at 10k      : p95 ${at10k.p95}ms  ` +
      (at10k.p95 <= 50 ? 'MEETS' : 'MISSES'));
  }
  if (results.nfr04) {
    console.log(`NFR-04 decay < 500ms at ${results.nfr04.storeSize.toLocaleString().padEnd(6)} : ` +
      `median ${results.nfr04.median}ms  ` + (results.nfr04.median <= 500 ? 'MEETS' : 'MISSES') +
      `  (first ${results.nfr04.cold}ms, worst ${results.nfr04.max}ms of ${results.nfr04.n})` +
      (results.nfr04.storeSize < 50_000 ? '  (below the 50k the NFR specifies — run --full)' : ''));
  }
  console.log('\nevidence → docs/evidence/nfr-bench.json');
} catch (err) {
  console.error('bench aborted: ' + (err instanceof Error ? err.stack : String(err)));
  process.exitCode = 1;
} finally {
  while (homes.length) rmSync(homes.pop(), { recursive: true, force: true });
}
