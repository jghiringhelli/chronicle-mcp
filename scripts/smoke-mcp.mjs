#!/usr/bin/env node
/**
 * Generative execution for UC-001 and UC-008: drive the built server as a real MCP client over
 * stdio, and prove the multi-instance contract (ADR-016) by running two clients at once.
 *
 * This is the verify step the method asks for — the agent operates the real machine rather than
 * inferring from a clean compile. Evidence is written to docs/evidence/.
 *
 * Usage: node scripts/smoke-mcp.mjs [--keep]   (--keep leaves the written memories in place)
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { writeFileSync, mkdirSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const SERVER = join(ROOT, 'dist', 'cli.js');
const KEEP = process.argv.includes('--keep');
const TAG = `smoke-${Date.now()}`;
const PROJECT = 'chronicle-smoke';

/**
 * A throwaway store for the run, via CHRONICLE_HOME.
 *
 * The first version of this script wrote into the developer's real ~/.chronicle and left rows
 * behind. A verification that pollutes the data it is verifying is one nobody runs twice — and it
 * also meant the concurrency checks below were racing against whatever the real store held. Both
 * spawned servers inherit this directory, so "two instances on one database" is still exactly what
 * is tested, just not on the production one.
 */
const SMOKE_HOME = mkdtempSync(join(tmpdir(), 'chronicle-smoke-'));
const cleanupHome = () => { if (!KEEP) rmSync(SMOKE_HOME, { recursive: true, force: true }); };

if (!existsSync(SERVER)) {
  console.error(`dist/cli.js is absent — run the build first.\n  expected: ${SERVER}`);
  process.exit(1);
}

const results = [];
const record = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

/** Spawn one client against the built server, exactly as an MCP host would. */
async function connect(label) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [SERVER],
    stderr: 'pipe',
    // Both instances share ONE throwaway store: the multi-instance contract (ADR-016) is the
    // point, the developer's real database is not.
    env: { ...process.env, CHRONICLE_HOME: SMOKE_HOME },
  });
  const client = new Client({ name: `smoke-${label}`, version: '1.0.0' });
  const started = Date.now();
  await client.connect(transport);
  return { client, transport, startMs: Date.now() - started };
}

/** Call a tool and return the parsed text payload. */
async function call(client, name, args) {
  const res = await client.callTool({ name, arguments: args });
  const text = (res.content ?? []).map((c) => c.text ?? '').join('\n');
  if (res.isError) throw new Error(`${name} returned an error: ${text}`);
  return text;
}

async function main() {
  // ── UC-008: the server starts and serves over stdio with no configuration ────────────────
  const a = await connect('A');
  record('UC-008 server starts over stdio with no configuration', true,
    `connect+handshake ${a.startMs}ms`);

  // ── ADR-011: a small action-dispatching surface, not twenty flat tools ───────────────────
  //
  // Four since the v0.4.0 merge added `team` (ADR-002). The assertion is exact on purpose: every
  // registered tool costs its whole JSON schema in the host's context on every turn, so the count
  // is a budget. A fifth tool appearing here without an ADR is the drift this catches — and it did
  // catch it, within minutes of the merge, when ADR-011 still said "three".
  const EXPECTED_TOOLS = ['axon', 'chronicle', 'session', 'team'];
  const { tools } = await a.client.listTools();
  const names = tools.map((t) => t.name).sort();
  record(`ADR-011 exactly ${EXPECTED_TOOLS.length} tools are registered`,
    names.length === EXPECTED_TOOLS.length && EXPECTED_TOOLS.every((n) => names.includes(n)),
    names.join(', '));

  const chronicleTool = tools.find((t) => t.name === 'chronicle');
  const actions = chronicleTool?.inputSchema?.properties?.action?.enum ?? [];
  record('ADR-011 chronicle dispatches on an action enum', actions.length >= 9,
    `${actions.length} actions: ${actions.join(' ')}`);

  // ── UC-001: a memory survives a session boundary and is recalled ─────────────────────────
  const content = `${TAG} railway does not persist /tmp across deploys`;
  const remembered = await call(a.client, 'chronicle', {
    action: 'remember', content, memory_type: 'semantic', project: PROJECT, tags: [TAG],
  });
  record('UC-001 step 1 remember succeeds', /id/i.test(remembered),
    remembered.replace(/\s+/g, ' ').slice(0, 120));

  // UC-001 expects tier `working` for a semantic memory (DEFAULT_TIERS, ADR-012) — the
  // use-case file asserted `buffer` until it was corrected. Verify against the real server.
  record('UC-001 semantic memory lands in the working tier (not buffer)',
    /working/i.test(remembered), /buffer/i.test(remembered) ? 'got buffer' : 'got working');

  // ── Cross-instance visibility: B is a SEPARATE process on the same database ──────────────
  const b = await connect('B');
  const recalledByB = await call(b.client, 'chronicle', {
    action: 'recall', query: 'railway deploys tmp', project: PROJECT,
  });
  record('ADR-016 a second instance recalls what the first one wrote',
    recalledByB.includes(TAG), recalledByB.includes(TAG) ? 'found by tag' : 'NOT FOUND');

  // ── Concurrent writes from both instances at once ────────────────────────────────────────
  const concurrent = await Promise.allSettled([
    call(a.client, 'chronicle', { action: 'remember', content: `${TAG} from instance A`, memory_type: 'episodic', project: PROJECT, tags: [TAG] }),
    call(b.client, 'chronicle', { action: 'remember', content: `${TAG} from instance B`, memory_type: 'episodic', project: PROJECT, tags: [TAG] }),
    call(a.client, 'chronicle', { action: 'recall', query: TAG, project: PROJECT }),
    call(b.client, 'chronicle', { action: 'recall', query: TAG, project: PROJECT }),
  ]);
  const rejected = concurrent.filter((r) => r.status === 'rejected');
  record('ADR-016 concurrent reads and writes from two instances all succeed',
    rejected.length === 0,
    rejected.length ? rejected.map((r) => String(r.reason).slice(0, 90)).join(' | ') : '4/4 ok');

  // ── Latency on the real surface (NFR-03 is about 10k memories; this is a floor, not a proof)
  const t0 = Date.now();
  await call(a.client, 'chronicle', { action: 'recall', query: 'railway', project: PROJECT });
  const recallMs = Date.now() - t0;
  record('recall round-trip over MCP is under 200ms at smoke-test scale', recallMs < 200,
    `${recallMs}ms (NOT an NFR-03 measurement — that needs 10k memories, see RM-104)`);

  // ── ADR-018: project identity is derived from the repository, scope is explicit ───────────
  //
  // The server inherits the host's working directory, so a memory written with no `project`
  // argument must land on this repository's derived identity — not on whatever label an agent
  // guessed. That is the drift this decision removes, so it is asserted against the live server.
  const derived = await call(a.client, 'chronicle', {
    action: 'remember', content: `${TAG} derived project identity check`, memory_type: 'semantic',
  });
  record('ADR-018 remember derives the project from the repo when none is given',
    /github\.com\/jghiringhelli\/chronicle-mcp/.test(derived),
    derived.replace(/\s+/g, ' ').slice(0, 150));
  record('ADR-018 the derived id comes from the remote, not a fallback',
    /"projectSource":"remote"/.test(derived),
    (/"projectSource":"([^"]+)"/.exec(derived) ?? [])[1] ?? '(absent)');
  record('ADR-018 a memory defaults to project scope',
    /"scope":"project"/.test(derived), (/"scope":"([^"]+)"/.exec(derived) ?? [])[1] ?? '(absent)');

  // A person-scoped memory is about the developer, so it must NOT be pinned to one repository —
  // pinning it would make it invisible from every other project, which is the opposite of the point.
  const personal = await call(a.client, 'chronicle', {
    action: 'remember', content: `${TAG} I prefer early returns over nested conditionals`,
    memory_type: 'semantic', scope: 'person',
  });
  record('ADR-018 a person-scoped memory is not pinned to a project',
    /"scope":"person"/.test(personal) && /"project":null|"project":undefined/.test(personal) === false
      ? !/"project":"github/.test(personal) : false,
    personal.replace(/\s+/g, ' ').slice(0, 140));

  // The ordinary recall returns both: what is true of this repo, and what is true of me.
  const both = await call(a.client, 'chronicle', { action: 'recall', query: TAG });
  record('ADR-018 recall returns project scope and person scope together',
    /"scope":"project"/.test(both) && /"scope":"person"/.test(both),
    `project:${/"scope":"project"/.test(both)} person:${/"scope":"person"/.test(both)}`);

  // ── session lifecycle (UC-004, F7) ──────────────────────────────────────────────────────
  const started = await call(a.client, 'session', { action: 'start', project: PROJECT });
  record('F7 session start returns context', started.length > 0,
    started.replace(/\s+/g, ' ').slice(0, 100));
  const ended = await call(a.client, 'session', { action: 'end', project: PROJECT, summary: `${TAG} smoke test` });
  record('F7 session end applies decay and promotion', ended.length > 0,
    ended.replace(/\s+/g, ' ').slice(0, 100));

  // ── axon is inert without a team configured (ADR-010 §3) ────────────────────────────────
  try {
    const axon = await call(a.client, 'axon', { action: 'status', project: PROJECT });
    record('ADR-010 axon answers without a team configured instead of throwing', true,
      axon.replace(/\s+/g, ' ').slice(0, 100));
  } catch (err) {
    record('ADR-010 axon answers without a team configured instead of throwing', false,
      String(err).slice(0, 140));
  }

  // ── cleanup ─────────────────────────────────────────────────────────────────────────────
  if (!KEEP) {
    const found = await call(a.client, 'chronicle', { action: 'recall', query: TAG, project: PROJECT, limit: 50 });
    const ids = [...found.matchAll(/\b(mem_[A-Za-z0-9_-]+|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\b/g)]
      .map((m) => m[1]);
    let forgotten = 0;
    for (const id of new Set(ids)) {
      try { await call(a.client, 'chronicle', { action: 'forget', id }); forgotten++; } catch { /* already gone */ }
    }
    // Redundant now that the whole store is a temp directory — kept because it exercises
    // `forget`, which is a contract worth running rather than assuming.
    record('forget removes a memory it wrote', forgotten > 0, `${forgotten} forgotten`);
  }

  await a.client.close();
  await b.client.close();

  // ── evidence ────────────────────────────────────────────────────────────────────────────
  const failed = results.filter((r) => !r.ok);
  const evidence = {
    ran_at: new Date().toISOString(),
    command: 'node scripts/smoke-mcp.mjs',
    node: process.version,
    platform: `${process.platform}-${process.arch}`,
    server: 'dist/cli.js',
    chronicle_home: 'throwaway temp directory (CHRONICLE_HOME) — the real ~/.chronicle is untouched',
    handshake_ms: { instanceA: a.startMs, instanceB: b.startMs },
    passed: results.length - failed.length,
    failed: failed.length,
    results,
  };
  mkdirSync(join(ROOT, 'docs', 'evidence'), { recursive: true });
  writeFileSync(join(ROOT, 'docs', 'evidence', 'mcp-smoke.json'),
    JSON.stringify(evidence, null, 2) + '\n', 'utf8');

  console.log(`\n${evidence.passed}/${results.length} checks passed → docs/evidence/mcp-smoke.json`);
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('smoke run aborted:', err);
  cleanupHome();
  process.exit(1);
});
