#!/usr/bin/env node
/**
 * Roles and row-level security for the shared mirror (ADR-019 §3, amended by ADR-020).
 *
 * ## What this creates, and the distinction that matters
 *
 * Two identities per person, because "operating the database" and "using the tool" are different
 * jobs:
 *
 *   - **admin role** (`chronicle_admin_<id>`) — member of `chronicle_admins`, owns the schema,
 *     can migrate, mint roles and read everything. Both partners get one, by decision.
 *   - **app role** (`chronicle_app_<id>`) — what Chronicle connects with day to day. NOT an admin,
 *     and row-level security confines it to its own rows.
 *
 * **So be clear about what the isolation does and does not buy.** A Postgres admin bypasses RLS by
 * definition. With both partners admin, RLS does **not** hide one partner's memories from the other
 * if they deliberately connect as admin — and pretending otherwise would be security theatre. What
 * it does buy is real:
 *
 *   - the day-to-day tool **cannot** read the other person's memories, so nothing leaks by accident,
 *     by a bug, or by a recall that forgot its filter;
 *   - a leaked *app* credential exposes one person's rows, not everyone's;
 *   - a third member added later gets genuine isolation without a schema change.
 *
 * ## Safety
 *
 * Additive and idempotent. It creates roles, enables RLS and defines policies. It does not drop
 * anything, does not rotate the existing `postgres` credential, and does not change any client's
 * configuration — so a partner still using the superuser string keeps working unchanged (and keeps
 * bypassing RLS, which is why ADR-019 says this is not in force until the clients switch).
 *
 * Dry by default. Passwords are generated, written to a local file the script names, and never
 * printed to stdout.
 *
 * Usage:
 *   CHRONICLE_CLOUD_URL="postgres://…" node scripts/apply-rls.mjs
 *   CHRONICLE_CLOUD_URL="postgres://…" node scripts/apply-rls.mjs --apply
 */

import postgres from 'postgres';
import { randomBytes } from 'node:crypto';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const url = process.env['CHRONICLE_CLOUD_URL'] ?? process.env['DATABASE_PUBLIC_URL'];
const APPLY = process.argv.includes('--apply');
if (!url) { console.error('Set CHRONICLE_CLOUD_URL.'); process.exit(1); }

/**
 * Tables owned by one person. RLS confines an app role to rows whose `user_id` is its own.
 * `users` is included: a person's own row, nobody else's.
 */
const PERSON_TABLES = ['memories', 'insights', 'session_summaries', 'sync_cursor', 'prompt_logs', 'users'];

/**
 * Tables the team shares. Every app role belonging to the team reads and writes these — that is what
 * makes them team tables, and it is the feature (ADR-019 §4: crossing to another person is
 * deliberate, and these tables *are* the deliberate act).
 */
const TEAM_TABLES = [
  'teams', 'team_members', 'team_shared_memories', 'team_insights', 'team_patterns',
  'team_contributors', 'team_work_packages', 'team_assignments', 'team_merge_requests',
];

/** Holds licence tokens. A token is a credential, not team knowledge — admins only. */
const ADMIN_ONLY_TABLES = ['team_licenses'];

const sql = postgres(url, { max: 1, idle_timeout: 5, connect_timeout: 20, onnotice: () => {} });
const plan = [];
const note = (s) => { plan.push(s); console.log('  ' + s); };

/** A role name Postgres accepts, derived from a chronicle userId. */
const roleName = (prefix, userId) => `${prefix}_${userId.replace(/[^a-zA-Z0-9_]/g, '_').toLowerCase()}`;

try {
  const target = new URL(url);
  console.log(`target: ${target.hostname}:${target.port}/${target.pathname.slice(1)} as ${target.username}`);
  console.log(APPLY ? 'mode:   APPLY\n' : 'mode:   dry run (pass --apply to change anything)\n');

  // Who are the people? The mirror already knows — no need to be told.
  const members = await sql`SELECT user_id, role FROM team_members ORDER BY user_id`;
  if (members.length === 0) throw new Error('no team_members rows — nothing to provision roles for');
  console.log('people found in the mirror: ' + members.map((m) => `${m.user_id}(${m.role})`).join(', ') + '\n');

  const secrets = {};

  // ── 1. A group role for admins, so membership is the grant rather than a per-role copy ────
  console.log('admin group:');
  if (APPLY) {
    await sql.unsafe(`DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'chronicle_admins') THEN
        CREATE ROLE chronicle_admins NOLOGIN;
      END IF;
    END $$;`);
    // The group carries the table privileges, so admin rights are one grant rather than a copy per
    // person. BYPASSRLS alone is not enough: it lets a role ignore policies, it does not grant the
    // privilege to read the table in the first place — which is how the first run of
    // scripts/verify-isolation.mjs failed with "permission denied for table memories" on the admin.
    await sql.unsafe(`GRANT USAGE ON SCHEMA public TO chronicle_admins`);
    await sql.unsafe(`GRANT ALL ON ALL TABLES IN SCHEMA public TO chronicle_admins`);
    await sql.unsafe(`GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO chronicle_admins`);
    // And for tables created later, so a future migration does not silently lock the admins out.
    await sql.unsafe(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO chronicle_admins`);
  }
  note('chronicle_admins (NOLOGIN group) — carries the table privileges; admin rights by membership');

  // ── 2. Per-person roles ───────────────────────────────────────────────────────────────────
  for (const { user_id: userId } of members) {
    const admin = roleName('chronicle_admin', userId);
    const app = roleName('chronicle_app', userId);
    const adminPw = randomBytes(24).toString('base64url');
    const appPw = randomBytes(24).toString('base64url');

    console.log(`\n${userId}:`);
    note(`${admin} — admin: can migrate, mint roles, read everything (bypasses RLS)`);
    note(`${app} — day-to-day: confined by RLS to user_id = '${userId}'`);

    if (APPLY) {
      for (const [role, pw, isAdmin] of [[admin, adminPw, true], [app, appPw, false]]) {
        await sql.unsafe(`DO $$ BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${role}') THEN
            CREATE ROLE ${role} LOGIN PASSWORD '${pw.replace(/'/g, "''")}';
          ELSE
            ALTER ROLE ${role} LOGIN PASSWORD '${pw.replace(/'/g, "''")}';
          END IF;
        END $$;`);
        if (isAdmin) {
          await sql.unsafe(`GRANT chronicle_admins TO ${role}`);
          // BYPASSRLS is what makes "admin" true rather than aspirational.
          await sql.unsafe(`ALTER ROLE ${role} BYPASSRLS CREATEROLE`);
        }
        await sql.unsafe(`GRANT USAGE ON SCHEMA public TO ${role}`);
      }

      // The app role's identity, readable from inside a policy. Set as a role default so every
      // connection carries it without the client having to remember.
      await sql.unsafe(`ALTER ROLE ${app} SET chronicle.user_id = '${userId.replace(/'/g, "''")}'`);

      for (const tbl of [...PERSON_TABLES, ...TEAM_TABLES]) {
        await sql.unsafe(`GRANT SELECT, INSERT, UPDATE, DELETE ON ${tbl} TO ${app}`);
      }
      for (const tbl of ADMIN_ONLY_TABLES) {
        await sql.unsafe(`REVOKE ALL ON ${tbl} FROM ${app}`);
      }
    }

    secrets[userId] = {
      admin: { role: admin, password: adminPw },
      app: { role: app, password: appPw },
    };
  }

  // ── 3. RLS on person-scoped tables ────────────────────────────────────────────────────────
  console.log('\nrow-level security:');
  for (const tbl of PERSON_TABLES) {
    const [exists] = await sql`
      SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=${tbl}`;
    if (!exists) { note(`${tbl} — absent, skipped`); continue; }

    const idCol = tbl === 'users' ? 'id' : 'user_id';
    note(`${tbl} — confined to ${idCol} = current_setting('chronicle.user_id')`);

    if (APPLY) {
      await sql.unsafe(`ALTER TABLE ${tbl} ENABLE ROW LEVEL SECURITY`);
      // Without FORCE, the table OWNER also bypasses RLS. Forcing it means only roles with
      // BYPASSRLS (the admins, deliberately) see everything.
      await sql.unsafe(`ALTER TABLE ${tbl} FORCE ROW LEVEL SECURITY`);
      await sql.unsafe(`DROP POLICY IF EXISTS chronicle_own_rows ON ${tbl}`);
      await sql.unsafe(`
        CREATE POLICY chronicle_own_rows ON ${tbl}
        USING (${idCol} = current_setting('chronicle.user_id', true))
        WITH CHECK (${idCol} = current_setting('chronicle.user_id', true))`);
    }
  }

  // ── 4. Team tables stay shared ────────────────────────────────────────────────────────────
  console.log('\nteam tables (shared by design, RLS not applied):');
  note(TEAM_TABLES.join(', '));
  console.log('\nadmin-only:');
  note(ADMIN_ONLY_TABLES.join(', ') + ' — holds licence tokens');

  if (!APPLY) {
    console.log('\nNothing was changed. Re-run with --apply.');
  } else {
    // Credentials go to a file, never to stdout: a transcript is not a secret store.
    const out = join(homedir(), '.chronicle', 'cloud-roles.json');
    mkdirSync(join(homedir(), '.chronicle'), { recursive: true });
    const base = new URL(url);
    const conn = (role, pw) =>
      `postgresql://${role}:${encodeURIComponent(pw)}@${base.hostname}:${base.port}${base.pathname}?sslmode=require`;
    writeFileSync(out, JSON.stringify({
      created_at: new Date().toISOString(),
      note: 'Generated by scripts/apply-rls.mjs. Give each person ONLY their own rows. ' +
            'Chronicle should be configured with the `app` connection string; the `admin` one is for ' +
            'migrations and inspection. Keep this file out of git.',
      people: Object.fromEntries(Object.entries(secrets).map(([userId, s]) => [userId, {
        app_role: s.app.role,
        app_connection_string: conn(s.app.role, s.app.password),
        admin_role: s.admin.role,
        admin_connection_string: conn(s.admin.role, s.admin.password),
      }])),
    }, null, 2) + '\n', 'utf8');
    console.log(`\nconnection strings written to ${out} (not printed here).`);
    console.log('RLS is NOT in force for any client still using the postgres superuser string.');
  }
} catch (err) {
  console.error('\nfailed: ' + (err instanceof Error ? err.message : String(err)));
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
