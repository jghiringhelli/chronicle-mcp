#!/usr/bin/env node
/**
 * Read-only inspection of the cloud mirror.
 *
 * Run this BEFORE pointing anything at a shared database. It prints the schema and row counts and
 * writes nothing — the cloud sync path has no tests against a real Postgres (EDR-003: the unit
 * tests use a fake `sql` client), and EDR-003 also records a suspected cursor defect. Knowing what
 * is already in there is the difference between verifying and gambling with someone else's data.
 *
 * The connection string is read from the environment and never printed.
 *
 *   # from a directory linked with `railway link`
 *   railway run node scripts/inspect-cloud-db.mjs
 *
 *   # or explicitly
 *   CHRONICLE_CLOUD_URL="postgres://..." node scripts/inspect-cloud-db.mjs
 *
 * Exit 0 = connected and reported. Exit 1 = could not connect.
 */

import postgres from 'postgres';

const url =
  process.env['CHRONICLE_CLOUD_URL'] ??
  process.env['DATABASE_PUBLIC_URL'] ??
  process.env['DATABASE_URL'];

if (!url) {
  console.error('No connection string. Set CHRONICLE_CLOUD_URL, or run under `railway run`.');
  process.exit(1);
}

/** Host and database only — never the credentials. */
function describeTarget(connectionString) {
  try {
    const u = new URL(connectionString);
    return `${u.hostname}:${u.port || 5432}/${u.pathname.replace(/^\//, '')} as ${u.username}`;
  } catch {
    return '(unparseable connection string)';
  }
}

const sql = postgres(url, { max: 1, idle_timeout: 5, connect_timeout: 15, onnotice: () => {} });

try {
  console.log('target: ' + describeTarget(url));
  const [{ version }] = await sql`SELECT version()`;
  console.log('server: ' + version.split(',')[0]);
  const [{ now }] = await sql`SELECT now()`;
  console.log('clock:  ' + now.toISOString());

  const tables = await sql`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    ORDER BY table_name
  `;

  if (tables.length === 0) {
    console.log('\nNo tables in the public schema — the cloud schema has never been applied.');
  } else {
    console.log(`\ntables (${tables.length}):`);
    for (const { table_name: name } of tables) {
      // Identifier interpolated through postgres.js's identifier helper, never string-concatenated.
      const [{ n }] = await sql`SELECT count(*)::int AS n FROM ${sql(name)}`;
      const cols = await sql`
        SELECT column_name, data_type
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = ${name}
        ORDER BY ordinal_position
      `;
      console.log(`  ${name.padEnd(24)} ${String(n).padStart(6)} rows   ${cols.length} cols`);
    }
  }

  // Who else is already using this database? The point of a shared mirror is more than one writer,
  // and a merge that assumes an empty table is how another developer's rows get overwritten.
  const hasUsers = tables.some((t) => t.table_name === 'users');
  if (hasUsers) {
    const users = await sql`SELECT id FROM users ORDER BY id`;
    console.log(`\nusers (${users.length}):`);
    for (const u of users) console.log('  ' + u.id);
  }

  for (const candidate of ['memories', 'insights', 'session_summaries', 'sync_cursor']) {
    if (!tables.some((t) => t.table_name === candidate)) continue;
    const cols = await sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = ${candidate}
    `;
    const names = cols.map((c) => c.column_name);
    if (names.includes('source_device')) {
      const devices = await sql`
        SELECT source_device, count(*)::int AS n FROM ${sql(candidate)}
        GROUP BY source_device ORDER BY n DESC LIMIT 10
      `;
      if (devices.length) {
        console.log(`\n${candidate} by source_device:`);
        for (const d of devices) console.log('  ' + String(d.source_device).padEnd(34) + d.n);
      }
    }
  }

  // ── Who is already on this mirror ────────────────────────────────────────────────────────
  //
  // The point of a shared database is more than one writer, and a verification run that assumes
  // an empty table is how another developer's rows get overwritten. Credentials and licence
  // tokens are redacted: this output is meant to be readable in a transcript.
  const redact = (v) =>
    v == null ? '(null)'
      : String(v).length > 12 ? String(v).slice(0, 6) + '…[' + String(v).length + ' chars]'
        : String(v);
  const safe = (row) => {
    const out = {};
    for (const [k, v] of Object.entries(row)) {
      out[k] = /token|secret|key|password/i.test(k) ? redact(v) : v;
    }
    return out;
  };

  const has = (name) => tables.some((t) => t.table_name === name);

  if (has('teams')) {
    console.log('\nteams:');
    for (const r of await sql`SELECT * FROM teams`) console.log('  ' + JSON.stringify(safe(r)));
  }
  if (has('team_members')) {
    console.log('\nteam_members:');
    for (const r of await sql`SELECT * FROM team_members`) console.log('  ' + JSON.stringify(safe(r)));
  }
  if (has('team_licenses')) {
    console.log('\nteam_licenses:');
    for (const r of await sql`SELECT * FROM team_licenses`) console.log('  ' + JSON.stringify(safe(r)));
  }
  if (has('team_shared_memories')) {
    console.log('\nteam_shared_memories:');
    for (const r of await sql`SELECT * FROM team_shared_memories`) {
      console.log('  ' + JSON.stringify({ ...safe(r), content: String(r.content).slice(0, 80) }));
    }
  }

  // ── Privacy check: ADR-019 §1 — raw prompt text must be impossible, not merely unused ───
  //
  // This used to report whether any row *carried* raw content, behind a `share_content` flag. The
  // columns are now dropped, so the check is the stronger one: assert they are absent. A flag is a
  // promise; an absent column is a property.
  //
  // (This check broke the first time it ran after the migration, because it still queried the
  // columns it had just helped remove. Worth noting: a tool that inspects a schema has to track it.)
  if (has('prompt_logs')) {
    const forbidden = await sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema='public' AND table_name='prompt_logs'
        AND column_name IN ('raw_content','share_content')`;
    console.log('\nprompt_logs privacy (ADR-019 §1):');
    if (forbidden.length === 0) {
      console.log('  raw_content / share_content: ABSENT — raw prompt capture is structurally impossible');
    } else {
      console.log('  PRESENT: ' + forbidden.map((c) => c.column_name).join(', ') +
        ' — run scripts/migrate-cloud-db.mjs --only 003-drop-raw-prompt-content --allow-destructive --apply');
      process.exitCode = 1;
    }

    const rows = await sql`
      SELECT user_id, project, pattern, outcome, category, logged_at
      FROM prompt_logs ORDER BY logged_at DESC LIMIT 20`;
    for (const r of rows) {
      console.log('  ' + JSON.stringify({
        user_id: r.user_id, project: r.project,
        pattern: String(r.pattern).slice(0, 60), outcome: r.outcome, category: r.category,
      }));
    }
  }

  // The cursor columns are worth printing: EDR-003 records a suspected defect in which column the
  // memory pull reads, and that is the failure mode a two-developer mirror would surface first.
  if (has('sync_cursor')) {
    const cols = await sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'sync_cursor'
      ORDER BY ordinal_position
    `;
    console.log('\nsync_cursor columns: ' + cols.map((c) => c.column_name).join(', '));
  }

  // ── What JavaScript types the driver actually hands back ─────────────────────────────────
  //
  // This is not trivia. postgres.js maps `timestamptz` to a JS **Date**, and the pull paths cast
  // those columns `as string` — a cast the compiler accepts and reality does not. better-sqlite3
  // then refuses the bind with "SQLite3 can only bind numbers, strings, bigints, buffers, and
  // null", which is exactly how the team pull was failing. Printing the real types is how that was
  // found, so the tool keeps doing it.
  for (const name of ['team_shared_memories', 'memories', 'team_insights', 'team_patterns']) {
    if (!has(name)) continue;
    const [row] = await sql`SELECT * FROM ${sql(name)} LIMIT 1`;
    if (!row) continue;
    console.log(`\n${name} — JS types returned by the driver:`);
    for (const [k, v] of Object.entries(row)) {
      const kind = v === null ? 'null' : (v.constructor?.name ?? typeof v);
      const flag = kind === 'Date' || kind === 'Array' ? '   <-- not bindable by SQLite' : '';
      console.log('  ' + k.padEnd(18) + kind + flag);
    }
  }

  // ── Identity consistency: does this machine's configured userId match the mirror? ────────
  //
  // `userId` is derived from `git config user.email` on first run and then stored. If the config
  // file is ever recreated — new machine, reset, different git email — it is re-derived to a
  // DIFFERENT value, and every row this machine already wrote becomes unreachable: the team gate
  // checks `team_members WHERE user_id = config.userId`, and the personal mirror filters on the
  // same field. A silently-changing identity is the one thing that breaks both layers at once.
  try {
    const { homedir } = await import('node:os');
    const { readFileSync: read } = await import('node:fs');
    const { join: joinPath } = await import('node:path');
    const cfgPath = joinPath(process.env['CHRONICLE_HOME'] ?? joinPath(homedir(), '.chronicle'), 'config.json');
    const configured = JSON.parse(read(cfgPath, 'utf8')).userId;

    const members = has('team_members')
      ? (await sql`SELECT user_id FROM team_members`).map((r) => r.user_id) : [];
    const memoryOwners = has('memories')
      ? (await sql`SELECT DISTINCT user_id FROM memories`).map((r) => r.user_id) : [];

    console.log('\nidentity consistency:');
    console.log('  this machine config.userId : ' + configured);
    console.log('  team_members in the mirror  : ' + (members.join(', ') || '(none)'));
    console.log('  memory owners in the mirror : ' + (memoryOwners.join(', ') || '(none)'));

    if (members.length && !members.includes(configured)) {
      console.log('  => MISMATCH: this machine is NOT a member under its configured id.');
      console.log('     The team gate will refuse, and pushed memories will land under an id that');
      console.log('     owns no membership. Align config.userId with the id already in the mirror.');
      process.exitCode = 1;
    } else if (members.length) {
      console.log('  => consistent');
    }
  } catch (err) {
    console.log('\nidentity consistency: could not read the local config (' +
      (err instanceof Error ? err.message : String(err)) + ')');
  }

  console.log('\nnothing was written.');
} catch (err) {
  console.error('could not inspect: ' + (err instanceof Error ? err.message : String(err)));
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
