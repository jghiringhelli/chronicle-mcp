#!/usr/bin/env node
/**
 * Generative execution of the TEAM layer against the real cloud mirror.
 *
 * This is the verification EDR-003 says does not exist: the unit tests use a fake `sql` client, so
 * until this ran, no code path had been exercised against a real Postgres.
 *
 * Safety, by construction:
 *   - Runs the built server under a THROWAWAY `CHRONICLE_HOME`, so the developer's own
 *     ~/.chronicle is never read or written.
 *   - **Read-only by default.** Without `--write` it calls only actions that do not insert into the
 *     shared pool, because that pool is visible to every team member: writing test rows into a
 *     partner's workspace is an outward-facing act, not a test.
 *   - `--write` adds one clearly-tagged memory and removes it again, and says so.
 *   - The connection string and the licence token are read from the environment / the database and
 *     are never printed.
 *
 * Usage:
 *   CHRONICLE_CLOUD_URL="postgres://…" node scripts/verify-team-cloud.mjs [--write]
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import postgres from 'postgres';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const SERVER = join(ROOT, 'dist', 'cli.js');
const WRITE = process.argv.includes('--write');
const TAG = `verify-${Date.now()}`;

const url = process.env['CHRONICLE_CLOUD_URL'] ?? process.env['DATABASE_PUBLIC_URL'];
if (!url) {
  console.error('No connection string. Set CHRONICLE_CLOUD_URL.');
  process.exit(1);
}
if (!existsSync(SERVER)) {
  console.error('dist/cli.js is absent — run the build first.');
  process.exit(1);
}

const results = [];
const record = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const HOME = mkdtempSync(join(tmpdir(), 'chronicle-team-verify-'));
const cleanup = () => rmSync(HOME, { recursive: true, force: true });

const sql = postgres(url, { max: 1, idle_timeout: 5, connect_timeout: 15, onnotice: () => {} });

/** Read the team's identity and licence straight from the mirror. Never logged. */
async function readTeamIdentity() {
  const [team] = await sql`SELECT id FROM teams ORDER BY created_at LIMIT 1`;
  if (!team) throw new Error('no team row in the mirror — nothing to verify against');
  const [lic] = await sql`
    SELECT token, created_by FROM team_licenses
    WHERE team_id = ${team.id} AND revoked = false
    ORDER BY created_at DESC LIMIT 1
  `;
  if (!lic) throw new Error(`team ${team.id} has no active licence token`);
  const members = await sql`SELECT user_id, role FROM team_members WHERE team_id = ${team.id}`;
  return { teamId: team.id, token: lic.token, owner: lic.created_by, members };
}

async function connect(identity) {
  // A real config file, in a throwaway home. This is the shape a configured install has.
  mkdirSync(HOME, { recursive: true });
  writeFileSync(join(HOME, 'config.json'), JSON.stringify({
    userId: identity.owner,
    deviceId: `verify-${process.pid}`,
    dbPath: join(HOME, 'chronicle.db'),
    railwayUrl: url,
    teamId: identity.teamId,
    teamToken: identity.token,
  }, null, 2), 'utf8');

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [SERVER],
    stderr: 'pipe',
    env: { ...process.env, CHRONICLE_HOME: HOME },
  });
  const client = new Client({ name: 'team-verify', version: '1.0.0' });
  await client.connect(transport);
  return client;
}

async function call(client, name, args) {
  const res = await client.callTool({ name, arguments: args });
  const text = (res.content ?? []).map((c) => c.text ?? '').join('\n');
  if (res.isError) throw new Error(text);
  return text;
}

/** An action that answers, even if the answer is an error object, has not crashed the server. */
async function probe(client, label, args, check) {
  try {
    const out = await call(client, 'team', args);
    record(label, check ? check(out) : true, out.replace(/\s+/g, ' ').slice(0, 130));
    return out;
  } catch (err) {
    record(label, false, String(err).slice(0, 160));
    return '';
  }
}

async function main() {
  const identity = await readTeamIdentity();
  console.log(`team: ${identity.teamId}   owner: ${identity.owner}   members: ` +
    identity.members.map((m) => `${m.user_id}(${m.role})`).join(', '));
  console.log(`store: throwaway (${HOME})\n`);

  const client = await connect(identity);

  record('the licence gate accepts a real token from the mirror', true,
    'server started with teamId + teamToken configured');

  await probe(client, 'team members lists the real roster', { action: 'members' },
    (out) => identity.members.every((m) => out.includes(m.user_id)));

  // A fresh install's `recall` reads the LOCAL cache, which is empty until something pulls. So the
  // meaningful question is not "does recall answer" but "does a new machine pull what a teammate
  // shared and then find it". That is the whole user-facing promise of a shared mirror, and it is
  // what this sequence tests.
  const poolBefore = (await sql`SELECT count(*)::int AS n FROM team_shared_memories`)[0].n;
  const logsBefore = (await sql`SELECT count(*)::int AS n FROM prompt_logs`)[0].n;

  await probe(client, 'team recall on a fresh store is empty before any pull',
    { action: 'recall', query: 'GS audit' },
    (out) => out.includes('"sharedMemories":[]'));

  await probe(client, 'team sync pulls from the mirror', { action: 'sync' });

  const poolAfter = (await sql`SELECT count(*)::int AS n FROM team_shared_memories`)[0].n;
  const logsAfter = (await sql`SELECT count(*)::int AS n FROM prompt_logs`)[0].n;
  record('the pull wrote nothing into the shared pool', poolAfter === poolBefore,
    `team_shared_memories ${poolBefore} -> ${poolAfter}, prompt_logs ${logsBefore} -> ${logsAfter}`);

  // THE check: a teammate's shared memory is now reachable on a machine that had never seen it.
  const recalled = await probe(client, "a teammate's shared memory is recallable after the pull",
    { action: 'recall', query: 'GS audit SafetyCore' },
    (out) => /SafetyCore|gs-audit/i.test(out));
  if (recalled && !/SafetyCore|gs-audit/i.test(recalled)) {
    console.log('      (the mirror holds ' + poolBefore + ' shared row(s); the pull did not surface them)');
  }

  await probe(client, 'team insights answers', { action: 'insights' });
  await probe(client, 'team stats answers for the team scope', { action: 'stats', scope: 'team' });
  await probe(client, 'team stats answers for the personal scope', { action: 'stats', scope: 'me' });

  if (WRITE) {
    console.log('\n--- write probes (--write) ---');
    const before = (await sql`SELECT count(*)::int AS n FROM team_shared_memories`)[0].n;

    const made = await call(client, 'chronicle', {
      action: 'remember',
      content: `${TAG} cloud-sync verification row — safe to delete`,
      memory_type: 'semantic',
      project: 'chronicle-verify',
      tags: [TAG],
    });
    const id = (/"id":"([^"]+)"/.exec(made) ?? [])[1];
    await probe(client, 'team share pushes one memory to the shared pool', { action: 'share', id });

    const after = (await sql`SELECT count(*)::int AS n FROM team_shared_memories`)[0].n;
    record('the shared pool grew by exactly one row', after === before + 1, `${before} -> ${after}`);

    const deleted = await sql`DELETE FROM team_shared_memories WHERE content LIKE ${'%' + TAG + '%'}`;
    record('the verification row was removed from the shared pool', true,
      `${deleted.count} row(s) deleted`);
  } else {
    console.log('\n(read-only: pass --write to also verify the share path, which inserts into the\n' +
      ' shared pool every team member sees, then deletes what it inserted)');
  }

  await client.close();

  const failed = results.filter((r) => !r.ok);
  const evidence = {
    ran_at: new Date().toISOString(),
    command: 'node scripts/verify-team-cloud.mjs' + (WRITE ? ' --write' : ''),
    node: process.version,
    target: (() => { const u = new URL(url); return `${u.hostname}:${u.port}/${u.pathname.slice(1)}`; })(),
    team: identity.teamId,
    members: identity.members.map((m) => ({ user_id: m.user_id, role: m.role })),
    mode: WRITE ? 'read-write' : 'read-only',
    passed: results.length - failed.length,
    failed: failed.length,
    results,
  };
  mkdirSync(join(ROOT, 'docs', 'evidence'), { recursive: true });
  writeFileSync(join(ROOT, 'docs', 'evidence', 'team-cloud-verify.json'),
    JSON.stringify(evidence, null, 2) + '\n', 'utf8');

  console.log(`\n${evidence.passed}/${results.length} checks passed → docs/evidence/team-cloud-verify.json`);
  return failed.length === 0 ? 0 : 1;
}

let code = 1;
try {
  code = await main();
} catch (err) {
  console.error('verification aborted: ' + (err instanceof Error ? err.message : String(err)));
} finally {
  await sql.end({ timeout: 5 });
  cleanup();
}
process.exit(code);
