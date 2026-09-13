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
    if (results.nfr02 === null) results.nfr02 = { ms: +coldStartMs.toFixed(2), target: 200 };
    console.log(`  cold start (spawn → first answer): ${coldStartMs.toFixed(1)}ms  [NFR-02 < 200ms]`);

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
    if (size === Math.max(...sizes)) {
      const t = performance.now();
      await client.callTool({ name: 'chronicle', arguments: { action: 'decay' } });
      const ms = performance.now() - t;
      results.nfr04 = { storeSize: size, ms: +ms.toFixed(2), target: 500 };
      console.log(`  decay + promotion pass: ${ms.toFixed(1)}ms at ${size.toLocaleString()} ` +
        `[NFR-04 < 500ms at 50k]`);
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
          'TWO queries per call since ADR-018 (project scope + person scope).',
    nfr02_cold_start: results.nfr02,
    nfr03_recall: results.nfr03,
    nfr04_decay_pass: results.nfr04,
  };
  mkdirSync(join(ROOT, 'docs', 'evidence'), { recursive: true });
  writeFileSync(join(ROOT, 'docs', 'evidence', 'nfr-bench.json'),
    JSON.stringify(evidence, null, 2) + '\n', 'utf8');

  console.log('\n── verdicts ──');
  console.log(`NFR-02 cold start < 200ms        : ${results.nfr02.ms}ms  ` +
    (results.nfr02.ms <= 200 ? 'MEETS' : 'MISSES'));
  const at10k = results.nfr03.find((r) => r.storeSize === 10_000);
  if (at10k) {
    console.log(`NFR-03 recall < 50ms at 10k      : p95 ${at10k.p95}ms  ` +
      (at10k.p95 <= 50 ? 'MEETS' : 'MISSES'));
  }
  if (results.nfr04) {
    console.log(`NFR-04 decay < 500ms at ${results.nfr04.storeSize.toLocaleString().padEnd(6)} : ` +
      `${results.nfr04.ms}ms  ` + (results.nfr04.ms <= 500 ? 'MEETS' : 'MISSES') +
      (results.nfr04.storeSize < 50_000 ? '  (below the 50k the NFR specifies — run --full)' : ''));
  }
  console.log('\nevidence → docs/evidence/nfr-bench.json');
} catch (err) {
  console.error('bench aborted: ' + (err instanceof Error ? err.stack : String(err)));
  process.exitCode = 1;
} finally {
  while (homes.length) rmSync(homes.pop(), { recursive: true, force: true });
}
