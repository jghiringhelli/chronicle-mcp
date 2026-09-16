#!/usr/bin/env node
/**
 * Prove the isolation, from the restricted side (ADR-019 §3).
 *
 * An isolation claim that has not been tested by connecting **as** the confined role is not a claim.
 * This connects as each person's *app* role and asserts that the other person's rows are invisible
 * and unwritable, that the team tables are still shared, and that licence tokens are out of reach.
 *
 * It also asserts the honest limit: an **admin** role sees everything. Both partners are admins by
 * decision (ADR-020), so this is not a gap, it is the boundary — and a test that quietly omitted it
 * would be implying a guarantee that does not exist.
 *
 * Reads role connection strings from ~/.chronicle/cloud-roles.json, written by scripts/apply-rls.mjs.
 * Nothing is printed that could reconstruct a credential.
 *
 * Usage: node scripts/verify-isolation.mjs
 */

import postgres from 'postgres';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const rolesPath = join(homedir(), '.chronicle', 'cloud-roles.json');

let roles;
try {
  roles = JSON.parse(readFileSync(rolesPath, 'utf8')).people;
} catch {
  console.error(`Could not read ${rolesPath}. Run scripts/apply-rls.mjs --apply first.`);
  process.exit(1);
}

const people = Object.keys(roles);
if (people.length < 2) {
  console.error('Need at least two people to test isolation between them.');
  process.exit(1);
}

const results = [];
const record = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const connect = (connectionString) =>
  postgres(connectionString, { max: 1, idle_timeout: 5, connect_timeout: 20, onnotice: () => {} });

/** A seeded row per person, so there is something to fail to see. */
const SEED = `iso-${Date.now()}`;
const open = [];

try {
  const [a, b] = people;
  console.log(`people: ${a}, ${b}\n`);

  // Seed one memory per person using each person's OWN app role, which also proves a write works.
  for (const who of [a, b]) {
    const sql = connect(roles[who].app_connection_string);
    open.push(sql);
    await sql`INSERT INTO users (id) VALUES (${who}) ON CONFLICT DO NOTHING`;
    await sql`
      INSERT INTO memories (id, user_id, content, memory_type, tier, weight, decay_rate,
        access_count, created_at, last_accessed_at, scope, tags, confirmed, updated_at)
      VALUES (${`${SEED}-${who}`}, ${who}, ${`${SEED} private to ${who}`}, 'semantic', 'core',
        0.9, 0, 0, NOW(), NOW(), 'person', '{}', true, NOW())
      ON CONFLICT (id) DO NOTHING`;
  }
  record('each app role can write its own row', true, `seeded one memory for ${a} and ${b}`);

  const sqlA = open[0];

  // ── The core claim ────────────────────────────────────────────────────────────────────────
  const ownRows = await sqlA`SELECT id FROM memories WHERE content LIKE ${`${SEED}%`}`;
  record(`${a}'s app role sees ONLY its own seeded row`,
    ownRows.length === 1 && ownRows[0].id === `${SEED}-${a}`,
    `${ownRows.length} row(s): ${ownRows.map((r) => r.id).join(', ')}`);

  const otherByFilter = await sqlA`SELECT id FROM memories WHERE user_id = ${b}`;
  record(`${a}'s app role cannot see ${b}'s rows even when asking for them directly`,
    otherByFilter.length === 0,
    `${otherByFilter.length} row(s) returned for user_id = '${b}'`);

  const everything = await sqlA`SELECT count(*)::int AS n FROM memories`;
  const mine = await sqlA`SELECT count(*)::int AS n FROM memories WHERE user_id = ${a}`;
  record('an unfiltered SELECT returns only this person\'s rows, not the whole table',
    everything[0].n === mine[0].n,
    `unfiltered=${everything[0].n} own=${mine[0].n}`);

  // ── Writes are confined too, not just reads ───────────────────────────────────────────────
  let forgedInsert = 'no error';
  try {
    await sqlA`
      INSERT INTO memories (id, user_id, content, memory_type, tier, weight, decay_rate,
        access_count, created_at, last_accessed_at, scope, tags, confirmed, updated_at)
      VALUES (${`${SEED}-forged`}, ${b}, 'forged on behalf of someone else', 'semantic', 'core',
        0.9, 0, 0, NOW(), NOW(), 'person', '{}', true, NOW())`;
  } catch (err) {
    forgedInsert = err instanceof Error ? err.message : String(err);
  }
  record(`${a} cannot write a row owned by ${b}`, forgedInsert !== 'no error',
    forgedInsert.slice(0, 90));

  const updated = await sqlA`UPDATE memories SET weight = 0.1 WHERE user_id = ${b}`;
  record(`${a} cannot update ${b}'s rows`, updated.count === 0, `${updated.count} row(s) updated`);

  const deleted = await sqlA`DELETE FROM memories WHERE user_id = ${b}`;
  record(`${a} cannot delete ${b}'s rows`, deleted.count === 0, `${deleted.count} row(s) deleted`);

  // ── Is the confinement a boundary, or a default? ───────────────────────────────────
  //
  // Every check above asks whether the policy holds *while the session behaves*. This one asks what
  // happens when it does not, and it is the check that decides what an app credential is worth.
  //
  // The policy is `USING (user_id = current_setting('chronicle.user_id', true))`, and the value is
  // pinned with `ALTER ROLE <app> SET chronicle.user_id = '<id>'`. `ALTER ROLE ... SET` establishes a
  // DEFAULT. Custom GUCs have no GRANT of their own, so unless something prevents it, a session can
  // simply `SET chronicle.user_id` to another person's id and the policy will admit their rows —
  // the role is then confined only by its own good manners.
  //
  // Nobody's data is read here. The variable is set to a value matching no user, and read back: if
  // the read-back changes, the override works and that is the whole finding.
  // The claim a client can still make, and the access it must no longer buy.
  //
  // Before ADR-024 the policy read `current_setting('chronicle.user_id')`, so re-pointing that
  // variable handed the session another person's rows. The variable still EXISTS and any session can
  // still set it — that was never preventable, a custom GUC carries no privilege — so asserting that
  // the SET fails would be testing a mechanism nobody promised. What matters is whether the claim
  // buys anything, and after the fix the policy resolves identity through `chronicle_role_map` keyed
  // on `current_user`, which a session cannot change without credentials for the other role.
  //
  // So: lie about who you are, as loudly as possible, then try every operation that used to work.
  await sqlA.unsafe(`SET chronicle.user_id = '${b}'`);

  const lyingRead = await sqlA`SELECT id FROM memories WHERE user_id = ${b}`;
  const lyingUpdate = await sqlA`UPDATE memories SET weight = 0.1 WHERE user_id = ${b}`;
  let lyingInsert = 'no error';
  try {
    await sqlA`
      INSERT INTO memories (id, user_id, content, memory_type, tier, weight, decay_rate,
        access_count, created_at, last_accessed_at, scope, tags, confirmed, updated_at)
      VALUES (${`${SEED}-lying`}, ${b}, 'written while claiming to be someone else', 'semantic',
        'core', 0.9, 0, 0, NOW(), NOW(), 'person', '{}', true, NOW())`;
  } catch (err) {
    lyingInsert = err instanceof Error ? err.message : String(err);
  }
  await sqlA.unsafe('RESET chronicle.user_id');

  const claimBuysNothing =
    lyingRead.length === 0 && lyingUpdate.count === 0 && lyingInsert !== 'no error';

  record(
    `claiming to be ${b} via chronicle.user_id buys ${a}'s app role nothing`,
    claimBuysNothing,
    claimBuysNothing
      ? 'read 0 rows, updated 0 rows, insert refused by the policy — identity comes from ' +
        'current_user through chronicle_role_map, not from the session (ADR-024)'
      : `LEAK: read ${lyingRead.length} row(s), updated ${lyingUpdate.count}, ` +
        `insert ${lyingInsert === 'no error' ? 'SUCCEEDED' : 'refused'}`,
  );

  // And the map itself must not be a way around the map.
  let mapWrite = 'no error';
  try {
    await sqlA`UPDATE chronicle_role_map SET user_id = ${b} WHERE role_name = current_user`;
  } catch (err) {
    mapWrite = err instanceof Error ? err.message : String(err);
  }
  record('an app role cannot rewrite its own row in chronicle_role_map', mapWrite !== 'no error',
    mapWrite.slice(0, 90));


  // ── Team tables stay shared — that is the feature, not a leak ──────────────────────────────
  const sharedPool = await sqlA`SELECT count(*)::int AS n FROM team_shared_memories`;
  record('team tables remain readable by every app role (ADR-019 §4)', sharedPool[0].n >= 1,
    `${sharedPool[0].n} shared memory row(s) visible`);

  const members = await sqlA`SELECT count(*)::int AS n FROM team_members`;
  record('the roster remains readable, so the team gate still works', members[0].n >= 2,
    `${members[0].n} member(s) visible`);

  // ── Licence tokens are a credential, not team knowledge ───────────────────────────────────
  let licenceRead = 'no error';
  try {
    await sqlA`SELECT token FROM team_licenses`;
  } catch (err) {
    licenceRead = err instanceof Error ? err.message : String(err);
  }
  record('an app role cannot read licence tokens', licenceRead !== 'no error',
    licenceRead.slice(0, 90));

  // ── The honest limit: an admin sees everything, by decision ────────────────────────────────
  const sqlAdmin = connect(roles[a].admin_connection_string);
  open.push(sqlAdmin);
  const adminSees = await sqlAdmin`SELECT count(*)::int AS n FROM memories WHERE content LIKE ${`${SEED}%`}`;
  record('an ADMIN role sees both people\'s rows — the boundary, not a bug (ADR-020)',
    adminSees[0].n === 2,
    `${adminSees[0].n} of 2 seeded rows visible to ${roles[a].admin_role}`);

  // ── Can this suite detect a leak at all? ─────────────────────────────────────────
  //
  // Every check above passes. That is exactly the position this suite was in on 2026-09-11, when it
  // reported 12/12 against a policy that trusted whatever the client claimed — and a confident
  // number on an untested property is what kept the hole invisible for three days.
  //
  // So the suite proves it can still fail. A throwaway table gets the OLD policy form
  // (`current_setting('chronicle.user_id')`), and the same lie that buys nothing against the real
  // tables is replayed against it. If the lie works there, the detection logic is sound and the real
  // tables are safe because of the policy, not because the check stopped looking.
  //
  // Built and dropped by the admin connection, named so it is obviously disposable, and it never
  // holds anybody's data — only two rows this script wrote.
  const PROBE = 'chronicle_leak_probe';
  let selfTest = 'did not run';
  try {
    await sqlAdmin.unsafe(`DROP TABLE IF EXISTS ${PROBE}`);
    await sqlAdmin.unsafe(`CREATE TABLE ${PROBE} (id text PRIMARY KEY, user_id text NOT NULL)`);
    await sqlAdmin.unsafe(`ALTER TABLE ${PROBE} ENABLE ROW LEVEL SECURITY`);
    await sqlAdmin.unsafe(`ALTER TABLE ${PROBE} FORCE ROW LEVEL SECURITY`);
    // Deliberately the vulnerable form this project shipped before ADR-024.
    await sqlAdmin.unsafe(`
      CREATE POLICY ${PROBE}_own ON ${PROBE}
      USING (user_id = current_setting('chronicle.user_id', true))
      WITH CHECK (user_id = current_setting('chronicle.user_id', true))`);
    await sqlAdmin.unsafe(`GRANT SELECT, INSERT, UPDATE, DELETE ON ${PROBE} TO ${roles[a].app_role}`);
    await sqlAdmin`INSERT INTO ${sqlAdmin(PROBE)} (id, user_id) VALUES (${`${SEED}-probe`}, ${b})`;

    // The same lie, against a table that trusts it.
    await sqlA.unsafe(`SET chronicle.user_id = '${b}'`);
    const leaked = await sqlA.unsafe(`SELECT id FROM ${PROBE} WHERE user_id = '${b}'`);
    await sqlA.unsafe('RESET chronicle.user_id');

    selfTest = leaked.length > 0 ? 'detected' : 'BLIND';
  } catch (err) {
    selfTest = `errored: ${err instanceof Error ? err.message : String(err)}`;
  } finally {
    await sqlAdmin.unsafe(`DROP TABLE IF EXISTS ${PROBE}`);
  }

  record(
    'the leak check can still detect a leak (replayed against a deliberately vulnerable table)',
    selfTest === 'detected',
    selfTest === 'detected'
      ? 'the old policy form leaks on demand, so the pass above is the policy holding, not the ' +
        'check having stopped looking'
      : `self-test ${selfTest} — treat every other result in this run as unverified`,
  );

  // ── Cleanup, as admin, since each app role can only reach its own ─────────────────────────
  const cleaned = await sqlAdmin`DELETE FROM memories WHERE content LIKE ${`${SEED}%`}`;
  record('seeded rows cleaned up', true, `${cleaned.count} row(s) deleted`);

  const failed = results.filter((r) => !r.ok);
  const target = new URL(roles[a].app_connection_string);
  const evidence = {
    ran_at: new Date().toISOString(),
    command: 'node scripts/verify-isolation.mjs',
    target: `${target.hostname}:${target.port}${target.pathname}`,
    people,
    model: 'Two admins by decision (ADR-020). RLS confines the day-to-day app roles; admins bypass it.',
    passed: results.length - failed.length,
    failed: failed.length,
    results,
  };
  mkdirSync(join(ROOT, 'docs', 'evidence'), { recursive: true });
  writeFileSync(join(ROOT, 'docs', 'evidence', 'isolation-verify.json'),
    JSON.stringify(evidence, null, 2) + '\n', 'utf8');

  console.log(`\n${evidence.passed}/${results.length} checks passed → docs/evidence/isolation-verify.json`);
  process.exitCode = failed.length === 0 ? 0 : 1;
} catch (err) {
  console.error('verification aborted: ' + (err instanceof Error ? err.message : String(err)));
  process.exitCode = 1;
} finally {
  for (const sql of open) await sql.end({ timeout: 5 }).catch(() => {});
}
