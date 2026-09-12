#!/usr/bin/env node
/**
 * Generative execution of the PERSONAL cross-machine mirror (ADR-018 §3) against a real Postgres.
 *
 * Until this ran, `syncMemories` / `syncInsights` had never executed anywhere: they were exported
 * and called by no production code path, which is why `users`, `memories` and `sync_cursor` are empty
 * in the live database while the team tables hold real rows.
 *
 * It simulates two machines by running two servers with different `deviceId` values over the same
 * `userId` — which is exactly what the cursor is keyed on, `(device_id, user_id)`. That exercises the
 * cursor, the conflict policy and the scope rules. It does **not** prove behaviour across two real
 * hosts; that needs two hosts, and this script says so rather than implying otherwise.
 *
 * Safety:
 *   - Throwaway `CHRONICLE_HOME` per simulated machine; the real ~/.chronicle is untouched.
 *   - A throwaway `userId` (`zz-verify-<timestamp>`), so it can never collide with a real person's
 *     rows, and its rows are deleted at the end.
 *   - Team tables are never written.
 *   - The connection string is read from the environment and never printed.
 *
 * Usage: CHRONICLE_CLOUD_URL="postgres://…" node scripts/verify-cloud-sync.mjs
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import postgres from 'postgres';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const SERVER = join(ROOT, 'dist', 'cli.js');
const url = process.env['CHRONICLE_CLOUD_URL'] ?? process.env['DATABASE_PUBLIC_URL'];

if (!url) { console.error('Set CHRONICLE_CLOUD_URL.'); process.exit(1); }
if (!existsSync(SERVER)) { console.error('dist/cli.js absent — build first.'); process.exit(1); }

const STAMP = Date.now();
const USER = `zz-verify-${STAMP}`;
const TAG = `sync-${STAMP}`;
const PROJECT = 'github.com/zz-verify/sync-probe';

const results = [];
const record = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const homes = [];
const sql = postgres(url, { max: 2, idle_timeout: 5, connect_timeout: 15, onnotice: () => {} });

/** One simulated machine: its own store, its own deviceId, the same person. */
async function machine(label) {
  const home = mkdtempSync(join(tmpdir(), `chronicle-${label}-`));
  homes.push(home);
  writeFileSync(join(home, 'config.json'), JSON.stringify({
    userId: USER,
    deviceId: `device-${label}-${STAMP}`,
    dbPath: join(home, 'chronicle.db'),
    railwayUrl: url,
  }, null, 2), 'utf8');

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [SERVER],
    stderr: 'pipe',
    env: { ...process.env, CHRONICLE_HOME: home },
  });
  const client = new Client({ name: `sync-${label}`, version: '1.0.0' });
  await client.connect(transport);
  return { label, home, client };
}

async function call(m, name, args) {
  const res = await m.client.callTool({ name, arguments: args });
  const text = (res.content ?? []).map((c) => c.text ?? '').join('\n');
  if (res.isError) throw new Error(`${m.label}/${name}: ${text}`);
  return text;
}

async function cleanup() {
  try {
    await sql`DELETE FROM sync_cursor WHERE user_id = ${USER}`;
    await sql`DELETE FROM memories WHERE user_id = ${USER}`;
    await sql`DELETE FROM insights WHERE user_id = ${USER}`;
    await sql`DELETE FROM session_summaries WHERE user_id = ${USER}`;
    await sql`DELETE FROM users WHERE id = ${USER}`;
  } catch { /* best effort */ }
  while (homes.length) rmSync(homes.pop(), { recursive: true, force: true });
}

async function main() {
  console.log(`user: ${USER}   project: ${PROJECT}`);
  const target = new URL(url);
  console.log(`target: ${target.hostname}:${target.port}\n`);

  const a = await machine('A');

  // ── Machine A learns two things and ends its session, which is what pushes ────────────────
  await call(a, 'chronicle', {
    action: 'remember', content: `${TAG} the deploy needs DATABASE_URL set at build time`,
    memory_type: 'semantic', project: PROJECT, scope: 'project', confirmed: true,
  });
  await call(a, 'chronicle', {
    action: 'remember', content: `${TAG} I prefer early returns over nested conditionals`,
    memory_type: 'semantic', scope: 'person', confirmed: true,
  });

  await call(a, 'session', { action: 'start', project: PROJECT });
  const endedA = await call(a, 'session', { action: 'end', project: PROJECT, summary: `${TAG} machine A` });

  record('ADR-018 session end reports the mirror when a remote is configured',
    /"mirror"/.test(endedA), endedA.replace(/\s+/g, ' ').slice(0, 150));

  const pushed = (await sql`SELECT count(*)::int AS n FROM memories WHERE user_id = ${USER}`)[0].n;
  record('ADR-018 session end pushed this machine\'s memories to the mirror', pushed >= 2,
    `${pushed} row(s) in the cloud for this user`);

  const scopes = await sql`
    SELECT scope, count(*)::int AS n FROM memories WHERE user_id = ${USER} GROUP BY scope ORDER BY scope`;
  record('ADR-018 both project and person scope reached the mirror',
    scopes.length === 2 && scopes.every((s) => s.n >= 1),
    scopes.map((s) => `${s.scope}:${s.n}`).join(' '));

  // The watermark lives in each machine's OWN SQLite, not in the cloud — which is correct: "what
  // have I already pushed" is per-machine state, and putting it in the mirror would add a round trip
  // to learn something only this machine knows. Losing it means a full resync, which is harmless.
  // (The cloud `sync_cursor` table is therefore unused by this path — recorded in EDR-003.)
  const localCursor = (home) => {
    const db = new Database(join(home, 'chronicle.db'), { readonly: true });
    try {
      return db.prepare('SELECT device_id, last_push_at, memories_version FROM sync_cursor').all();
    } finally { db.close(); }
  };

  const cursorA = localCursor(a.home);
  record('ADR-018 machine A keeps its own local watermark', cursorA.length === 1,
    cursorA.map((c) => `${c.device_id} v${c.memories_version}`).join(', ') || '(none)');

  // ── Machine B is a different device, same person, empty local store ───────────────────────
  const b = await machine('B');

  const beforePull = await call(b, 'chronicle', { action: 'recall', query: TAG });
  record('a second machine starts with nothing locally', !beforePull.includes(TAG),
    beforePull.slice(0, 60));

  // `session start` is what pulls (ADR-018 §3). No extra flag, no manual sync command.
  await call(b, 'session', { action: 'start', project: PROJECT });
  // The pull is fire-and-forget so a session can start offline; give it a moment to land.
  await new Promise((r) => setTimeout(r, 2500));

  const projectHit = await call(b, 'chronicle', { action: 'recall', query: 'deploy DATABASE_URL', project: PROJECT });
  record('ADR-018 machine B recalls the PROJECT memory machine A wrote',
    projectHit.includes(TAG), projectHit.includes(TAG) ? 'found' : projectHit.slice(0, 110));

  const personHit = await call(b, 'chronicle', { action: 'recall', query: 'early returns nested' });
  record('ADR-018 machine B recalls the PERSON memory machine A wrote',
    personHit.includes(TAG), personHit.includes(TAG) ? 'found' : personHit.slice(0, 110));

  record('ADR-018 the pulled project memory kept its derived identity',
    new RegExp(PROJECT.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).test(projectHit),
    (/"project":"([^"]*)"/.exec(projectHit) ?? [])[1] ?? '(absent)');

  record('ADR-018 the pulled person memory kept person scope',
    /"scope":"person"/.test(personHit), (/"scope":"([^"]+)"/.exec(personHit) ?? [])[1] ?? '(absent)');

  const cursorB = localCursor(b.home);
  record('ADR-018 each machine keeps its own watermark, not a shared one',
    cursorB.length === 1 && cursorB[0].device_id !== cursorA[0]?.device_id,
    `A: ${cursorA[0]?.device_id ?? 'none'}  B: ${cursorB[0]?.device_id ?? 'none'}`);

  const cloudCursors = (await sql`SELECT count(*)::int AS n FROM sync_cursor WHERE user_id = ${USER}`)[0].n;
  record('the cloud sync_cursor table stays empty, because nothing uses it', cloudCursors === 0,
    `${cloudCursors} row(s) — dead schema, see EDR-003`);

  // ── A memory B never had must not be resurrected as a duplicate ───────────────────────────
  const localCount = JSON.parse(await call(b, 'chronicle', { action: 'stats' })).total;
  await call(b, 'session', { action: 'start', project: PROJECT });
  await new Promise((r) => setTimeout(r, 2000));
  const afterSecondPull = JSON.parse(await call(b, 'chronicle', { action: 'stats' })).total;
  record('a second pull is idempotent, not a duplicator', afterSecondPull === localCount,
    `${localCount} -> ${afterSecondPull}`);

  // ── The conflict policy, with an actual conflict ──────────────────────────────────────────
  //
  // EDR-003 documents last-access-wins, comparing ISO strings lexicographically. That policy was
  // written for exactly this case and had NEVER been exercised with a real conflict: the earlier
  // checks only prove a row travels, not that the right version survives when two machines disagree.
  //
  // Both machines now hold the same memory. B touches it (recall reinforces, which bumps
  // last_accessed_at and weight), then both push. B's version must win on the mirror, and A must
  // receive it on its next pull rather than clobbering it with its own staler copy.
  const contested = await call(a, 'chronicle', {
    action: 'remember', content: `${TAG} contested row — both machines will touch this`,
    memory_type: 'semantic', project: PROJECT, scope: 'project', confirmed: true,
  });
  const contestedId = JSON.parse(contested).id;
  await call(a, 'session', { action: 'start', project: PROJECT });
  await call(a, 'session', { action: 'end', project: PROJECT });

  await call(b, 'session', { action: 'start', project: PROJECT });
  await new Promise((r) => setTimeout(r, 2500));

  const bHasIt = await call(b, 'chronicle', { action: 'recall', query: 'contested row', project: PROJECT });
  record('both machines now hold the contested row', bHasIt.includes(contestedId),
    bHasIt.includes(contestedId) ? 'B pulled it' : 'B never received it');

  // Snapshot the mirror BEFORE B touches anything. Comparing before/after is the only honest way
  // to assert "B's version won" — an absolute weight threshold would just be me re-deriving the
  // asymptote by hand, and `source_device` is not the tell: the ON CONFLICT clause updates weight,
  // access_count, last_accessed_at and tier, and deliberately leaves source_device as the inserter.
  const [beforeBTouch] = await sql`
    SELECT weight, last_accessed_at FROM memories WHERE id = ${contestedId}`;

  // B recalls it repeatedly: each hit reinforces, so B's copy ends with a later access and a higher
  // weight than the mirror currently holds. Then B pushes.
  for (let i = 0; i < 3; i++) {
    await call(b, 'chronicle', { action: 'recall', query: 'contested row', project: PROJECT });
  }
  await call(b, 'session', { action: 'end', project: PROJECT });

  const [mirrored] = await sql`
    SELECT weight, last_accessed_at, source_device FROM memories WHERE id = ${contestedId}`;
  const grew = mirrored !== undefined && beforeBTouch !== undefined &&
    Number(mirrored.weight) > Number(beforeBTouch.weight) &&
    new Date(mirrored.last_accessed_at) > new Date(beforeBTouch.last_accessed_at);
  record("EDR-003 B's more-recently-accessed version won on the mirror", grew,
    mirrored && beforeBTouch
      ? `weight ${Number(beforeBTouch.weight).toFixed(3)} -> ${Number(mirrored.weight).toFixed(3)}, ` +
        `accessed ${new Date(beforeBTouch.last_accessed_at).toISOString()} -> ${new Date(mirrored.last_accessed_at).toISOString()}`
      : 'row absent');

  // Now A pushes its STALER copy. The ON CONFLICT guard must refuse it.
  const weightBeforeAPush = mirrored ? Number(mirrored.weight) : 0;
  await call(a, 'session', { action: 'start', project: PROJECT });
  await call(a, 'session', { action: 'end', project: PROJECT });
  const [afterAPush] = await sql`SELECT weight FROM memories WHERE id = ${contestedId}`;
  record('EDR-003 a staler push does NOT overwrite the newer version',
    afterAPush !== undefined && Number(afterAPush.weight) >= weightBeforeAPush,
    `mirror weight ${weightBeforeAPush.toFixed(3)} -> ${afterAPush ? Number(afterAPush.weight).toFixed(3) : 'gone'}`);

  // ── Team scope must never reach the personal mirror (ADR-019 §4) ──────────────────────────
  await call(a, 'chronicle', {
    action: 'remember', content: `${TAG} team scoped, must not be mirrored`,
    memory_type: 'semantic', scope: 'team', confirmed: true,
  });
  await call(a, 'session', { action: 'start', project: PROJECT });
  await call(a, 'session', { action: 'end', project: PROJECT });
  const teamInMirror = (await sql`
    SELECT count(*)::int AS n FROM memories WHERE user_id = ${USER} AND scope = 'team'`)[0].n;
  record('ADR-019 team scope is never pushed to the personal mirror', teamInMirror === 0,
    `${teamInMirror} team-scoped row(s) in the personal mirror`);

  await a.client.close();
  await b.client.close();

  const failed = results.filter((r) => !r.ok);
  const evidence = {
    ran_at: new Date().toISOString(),
    command: 'node scripts/verify-cloud-sync.mjs',
    node: process.version,
    target: `${target.hostname}:${target.port}/${target.pathname.slice(1)}`,
    simulated_machines: 2,
    caveat: 'Two deviceIds on one host. Exercises the cursor, conflict policy and scope rules; does NOT prove behaviour across two real hosts.',
    throwaway_user: USER,
    passed: results.length - failed.length,
    failed: failed.length,
    results,
  };
  mkdirSync(join(ROOT, 'docs', 'evidence'), { recursive: true });
  writeFileSync(join(ROOT, 'docs', 'evidence', 'cloud-sync-verify.json'),
    JSON.stringify(evidence, null, 2) + '\n', 'utf8');

  console.log(`\n${evidence.passed}/${results.length} checks passed → docs/evidence/cloud-sync-verify.json`);
  return failed.length === 0 ? 0 : 1;
}

let code = 1;
try {
  code = await main();
} catch (err) {
  console.error('verification aborted: ' + (err instanceof Error ? err.message : String(err)));
} finally {
  await cleanup();
  await sql.end({ timeout: 5 });
}
process.exit(code);
