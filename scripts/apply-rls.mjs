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
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

/**
 * The connection this script runs as.
 *
 * Creating schema objects and altering table policies requires OWNERSHIP, which the
 * `chronicle_admin_*` roles do not have — in PostgreSQL 15+ the `public` schema no longer grants
 * CREATE, so an admin role gets `permission denied for schema public`. Provisioning therefore needs
 * Railway's own connection string, once.
 *
 * It is read from a file rather than an environment variable by preference, because putting a live
 * credential on a command line puts it in shell history and in any transcript of that session. The
 * file lives outside the repository, alongside the credentials this script writes.
 */
const adminUrlFile = join(homedir(), '.chronicle', 'railway-admin.url');
let fileUrl = null;
try {
  fileUrl = readFileSync(adminUrlFile, 'utf8').trim() || null;
} catch { /* not provided */ }

const url = process.env['CHRONICLE_CLOUD_URL'] ?? process.env['DATABASE_PUBLIC_URL'] ?? fileUrl;
const APPLY = process.argv.includes('--apply');

/**
 * Re-issue passwords for roles that already exist.
 *
 * Off by default, and that is a correction: this script used to `ALTER ROLE ... PASSWORD` on every
 * run, so applying an unrelated policy change silently invalidated every credential already handed
 * out — including a partner's. Rotation is now something you ask for.
 */
const ROTATE = process.argv.includes('--rotate');

/**
 * Non-human roles. A service account gets an app role and no admin role, and its rows live under its
 * own user id like anyone else's, so CI's writes are visible as CI's and confined to CI's.
 */
const SERVICE_ACCOUNTS = ['ci'];
if (!url) {
  console.error(
    'No connection string.\n' +
    `  Preferred: put Railway's DATABASE_PUBLIC_URL in ${adminUrlFile} (one line, nothing else).\n` +
    '  Railway dashboard → the Postgres service → Variables → DATABASE_PUBLIC_URL.\n' +
    '  It must be the PUBLIC url: the private one is not reachable from outside Railway.\n' +
    '  Or set CHRONICLE_CLOUD_URL, accepting that it lands in shell history.',
  );
  process.exit(1);
}

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

/**
 * Maps a database role to the chronicle user id it owns rows for (ADR-023, ADR-024).
 *
 * This table is what makes the confinement a boundary. The policy used to filter on
 * `current_setting('chronicle.user_id')`, pinned per role with `ALTER ROLE ... SET` — but that is a
 * DEFAULT, and a custom GUC carries no privilege, so any session could re-point it and read anyone's
 * rows. Verified against the real mirror before this change: it could.
 *
 * `current_user` cannot be changed without credentials for the other role (`SET ROLE` requires
 * membership), so keying off it removes the client's say in who it is.
 *
 * A lookup table rather than string surgery on the role name: `roleName()` sanitises a user id into
 * something Postgres accepts (`@` and `.` become `_`), so `substring(current_user from
 * '^chronicle_app_(.*)$')` would return the sanitised form, which is not the user id. Today's ids
 * happen to survive that unchanged; the first id containing a dot would not, and the failure would be
 * a person silently seeing no rows. It also lets a service account map to whatever id we choose.
 */
const ROLE_MAP_TABLE = 'chronicle_role_map';

/** Whatever was issued previously, so a re-run does not invalidate credentials already in use. */
let existing = null;
try {
  existing = JSON.parse(readFileSync(join(homedir(), '.chronicle', 'cloud-roles.json'), 'utf8'));
} catch { /* first run */ }

const sql = postgres(url, { max: 1, idle_timeout: 5, connect_timeout: 20, onnotice: () => {} });
const plan = [];
const note = (s) => { plan.push(s); console.log('  ' + s); };

/** A role name Postgres accepts, derived from a chronicle userId. */
const roleName = (prefix, userId) => `${prefix}_${userId.replace(/[^a-zA-Z0-9_]/g, '_').toLowerCase()}`;

try {
  const target = new URL(url);
  console.log(`target: ${target.hostname}:${target.port}/${target.pathname.slice(1)} as ${target.username}`);
  console.log(APPLY ? 'mode:   APPLY\n' : 'mode:   dry run (pass --apply to change anything)\n');

  // ── 0. Can this connection actually do the job? ────────────────────────────────────
  //
  // Asked up front because the alternative is what happened on 2026-09-14: `--apply` ran, issued
  // several GRANTs, and then died with `permission denied for schema public` partway through. A
  // provisioning script that fails halfway leaves a state nobody designed. Everything here is a
  // catalogue read — it changes nothing and runs in dry mode too.
  const [priv] = await sql`
    SELECT
      current_user                                                      AS role,
      current_database()                                                AS db,
      (SELECT rolsuper    FROM pg_roles WHERE rolname = current_user)    AS is_superuser,
      (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user)   AS bypasses_rls,
      (SELECT rolcreaterole FROM pg_roles WHERE rolname = current_user)  AS can_create_roles,
      has_schema_privilege(current_user, 'public', 'CREATE')             AS can_create_in_public,
      has_database_privilege(current_user, current_database(), 'CREATE') AS can_create_schemas`;

  // Altering a table's RLS and adding a policy requires OWNERSHIP, not a privilege — so ask who owns
  // the tables and whether this role is that owner (directly, or through a group it belongs to).
  const ownership = await sql`
    SELECT c.relname AS table_name,
           pg_get_userbyid(c.relowner) AS owner,
           pg_has_role(current_user, c.relowner, 'USAGE') AS can_act_as_owner
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname = ANY(${PERSON_TABLES})
    ORDER BY c.relname`;

  console.log('preflight:');
  note(`connected as ${priv.role} on ${priv.db}`);
  note(`superuser=${priv.is_superuser}  bypassrls=${priv.bypasses_rls}  createrole=${priv.can_create_roles}`);
  note(`CREATE on schema public: ${priv.can_create_in_public}   CREATE on database: ${priv.can_create_schemas}`);

  const notOwned = ownership.filter((r) => !r.can_act_as_owner);
  if (ownership.length === 0) {
    note('none of the person tables exist yet — nothing to re-own');
  } else if (notOwned.length === 0) {
    note(`owns (or can act as owner of) all ${ownership.length} person tables`);
  } else {
    note(`CANNOT act as owner of: ${notOwned.map((r) => `${r.table_name} (owned by ${r.owner})`).join(', ')}`);
  }

  // The two things --apply cannot do without.
  const blockers = [];
  if (!priv.can_create_in_public) {
    blockers.push(`CREATE on schema public — needed to create ${ROLE_MAP_TABLE}. PostgreSQL 15+ ` +
      'stopped granting this to PUBLIC, so only the schema owner or a superuser has it.');
  }
  if (notOwned.length > 0) {
    blockers.push(`ownership of ${notOwned.map((r) => r.table_name).join(', ')} — needed for ` +
      'ALTER TABLE ... FORCE ROW LEVEL SECURITY and CREATE POLICY, which are owner-only operations.');
  }

  if (blockers.length > 0) {
    console.error('\nthis connection cannot provision. Missing:\n');
    for (const b of blockers) console.error(`  - ${b}`);
    console.error(
      `\nUse Railway's own connection string for this run — put DATABASE_PUBLIC_URL in\n` +
      `  ${adminUrlFile}\n` +
      'Railway dashboard → the Postgres service → Variables → DATABASE_PUBLIC_URL (the PUBLIC one).\n' +
      'After one successful --apply the admin roles are granted CREATE on schema public AND the\n' +
      'tables are re-owned to the chronicle_admins group, so this is the last run that needs it.\n' +
      '(The grant alone is not enough: CREATE POLICY and FORCE ROW LEVEL SECURITY are owner-only,\n' +
      'and no GRANT confers them.)\n\n' +
      'Nothing was changed.',
    );
    process.exitCode = 1;
    await sql.end({ timeout: 5 });
    process.exit(1);
  }
  note('this connection can provision');
  console.log('');

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
    // CREATE too, so the next run of this script does not need Railway's own credential. Without it
    // an admin role cannot add a table and fails with "permission denied for schema public" — which
    // is exactly how this line came to be written.
    await sql.unsafe(`GRANT CREATE ON SCHEMA public TO chronicle_admins`);
    await sql.unsafe(`GRANT ALL ON ALL TABLES IN SCHEMA public TO chronicle_admins`);
    await sql.unsafe(`GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO chronicle_admins`);
    // And for tables created later, so a future migration does not silently lock the admins out.
    await sql.unsafe(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO chronicle_admins`);

    // Ownership, not just privileges. `CREATE POLICY` and `ALTER TABLE ... FORCE ROW LEVEL SECURITY`
    // are owner-only operations — no GRANT confers them — so while the tables belong to `postgres`,
    // every future policy change would need Railway's own credential again. Handing them to the
    // admin GROUP is what makes this the last privileged run.
    //
    // Safe for the people using the database: a superuser ignores ownership entirely, so Railway's
    // own connection is unaffected, and `chronicle_admins` members carry BYPASSRLS so FORCE RLS does
    // not lock them out of their own tables.
    for (const tbl of [...PERSON_TABLES, ...TEAM_TABLES, ...ADMIN_ONLY_TABLES, ROLE_MAP_TABLE]) {
      const [present] = await sql`
        SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=${tbl}`;
      if (present) await sql.unsafe(`ALTER TABLE ${tbl} OWNER TO chronicle_admins`);
    }
  }
  note('chronicle_admins (NOLOGIN group) — carries the table privileges; admin rights by membership');

  // ── 1b. The role → user id map, which the policies key off ───────────────────────────
  //
  // Created here, before any role needs mapping. The ownership sweep in step 1 runs earlier and so
  // skips this table; it takes its owner explicitly below instead.
  console.log('\nrole map:');
  note(`${ROLE_MAP_TABLE} — binds a login role to the user id it owns (ADR-024)`);
  if (APPLY) {
    await sql.unsafe(`
      CREATE TABLE IF NOT EXISTS ${ROLE_MAP_TABLE} (
        role_name text PRIMARY KEY,
        user_id   text NOT NULL
      )`);
    // Admins manage it; everyone else may read it and nothing more. Readable because the policy
    // subquery runs as the querying role — and role names are not a secret, the passwords are.
    await sql.unsafe(`GRANT ALL ON ${ROLE_MAP_TABLE} TO chronicle_admins`);
    // Re-owned here rather than in the sweep above, because that sweep runs before this table
    // exists. Ownership is what lets a later admin-only run alter it.
    await sql.unsafe(`ALTER TABLE ${ROLE_MAP_TABLE} OWNER TO chronicle_admins`);
  }

  // ── 2. Per-person roles ────────────────────────────────────────────────────────────
  const principals = [
    ...members.map((m) => ({ userId: m.user_id, service: false })),
    ...SERVICE_ACCOUNTS.map((id) => ({ userId: id, service: true })),
  ];

  for (const { userId, service } of principals) {
    const admin = service ? null : roleName('chronicle_admin', userId);
    const app = roleName('chronicle_app', userId);
    const adminPw = randomBytes(24).toString('base64url');
    const appPw = randomBytes(24).toString('base64url');

    // Keep a credential we already issued unless rotation was asked for. Without this, applying a
    // policy change re-issues everyone's password and breaks whoever is already using one.
    const knownApp = existing?.people?.[userId]?.app_connection_string
      ?? existing?.services?.[userId]?.app_connection_string;
    const knownAdmin = existing?.people?.[userId]?.admin_connection_string;
    const reuseApp = !ROTATE && Boolean(knownApp);
    const reuseAdmin = !ROTATE && Boolean(knownAdmin);

    console.log(`\n${userId}${service ? '  (service account)' : ''}:`);
    if (admin) note(`${admin} — admin: can migrate, mint roles, read everything (bypasses RLS)`);
    note(`${app} — day-to-day: confined by the role map to user_id = '${userId}'`);
    if (reuseApp || reuseAdmin) note('existing password kept (pass --rotate to re-issue)');

    if (APPLY) {
      const toProvision = [[app, appPw, false, reuseApp]];
      if (admin) toProvision.push([admin, adminPw, true, reuseAdmin]);
      for (const [role, pw, isAdmin, reuse] of toProvision) {
        await sql.unsafe(`DO $$ BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${role}') THEN
            CREATE ROLE ${role} LOGIN PASSWORD '${pw.replace(/'/g, "''")}';
          ${reuse ? '' : `ELSE
            ALTER ROLE ${role} LOGIN PASSWORD '${pw.replace(/'/g, "''")}';`}
          END IF;
        END $$;`);
        if (isAdmin) {
          await sql.unsafe(`GRANT chronicle_admins TO ${role}`);
          // BYPASSRLS is what makes "admin" true rather than aspirational.
          await sql.unsafe(`ALTER ROLE ${role} BYPASSRLS CREATEROLE`);
        }
        await sql.unsafe(`GRANT USAGE ON SCHEMA public TO ${role}`);
      }

      // The app role's identity, as a row the policy can look up. The old `ALTER ROLE ... SET
      // chronicle.user_id` default is cleared: leaving it would suggest it still governs anything,
      // and it governed less than it appeared to (ADR-023).
      await sql.unsafe(`
        INSERT INTO ${ROLE_MAP_TABLE} (role_name, user_id) VALUES ('${app}', '${userId.replace(/'/g, "''")}')
        ON CONFLICT (role_name) DO UPDATE SET user_id = EXCLUDED.user_id`);
      await sql.unsafe(`ALTER ROLE ${app} RESET chronicle.user_id`);
      await sql.unsafe(`GRANT SELECT ON ${ROLE_MAP_TABLE} TO ${app}`);
      await sql.unsafe(`REVOKE INSERT, UPDATE, DELETE ON ${ROLE_MAP_TABLE} FROM ${app}`);

      for (const tbl of [...PERSON_TABLES, ...TEAM_TABLES]) {
        await sql.unsafe(`GRANT SELECT, INSERT, UPDATE, DELETE ON ${tbl} TO ${app}`);
      }
      for (const tbl of ADMIN_ONLY_TABLES) {
        await sql.unsafe(`REVOKE ALL ON ${tbl} FROM ${app}`);
      }
    }

    secrets[userId] = {
      service,
      admin: admin ? { role: admin, password: adminPw, reuse: reuseAdmin, known: knownAdmin } : null,
      app: { role: app, password: appPw, reuse: reuseApp, known: knownApp },
    };
  }

  // ── 3. RLS on person-scoped tables ────────────────────────────────────────────────────────
  console.log('\nrow-level security:');
  for (const tbl of PERSON_TABLES) {
    const [exists] = await sql`
      SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=${tbl}`;
    if (!exists) { note(`${tbl} — absent, skipped`); continue; }

    const idCol = tbl === 'users' ? 'id' : 'user_id';
    note(`${tbl} — confined to ${idCol} = the user id ${ROLE_MAP_TABLE} gives for current_user`);

    if (APPLY) {
      await sql.unsafe(`ALTER TABLE ${tbl} ENABLE ROW LEVEL SECURITY`);
      // Without FORCE, the table OWNER also bypasses RLS. Forcing it means only roles with
      // BYPASSRLS (the admins, deliberately) see everything.
      await sql.unsafe(`ALTER TABLE ${tbl} FORCE ROW LEVEL SECURITY`);
      await sql.unsafe(`DROP POLICY IF EXISTS chronicle_own_rows ON ${tbl}`);
      // Keyed on current_user via the map, NOT on a session variable the client controls. This is
      // the whole of ADR-023's fix: `SET ROLE` requires membership, so a session cannot become
      // another role, and there is no longer anything it can set to claim otherwise.
      const owner = `(SELECT m.user_id FROM ${ROLE_MAP_TABLE} m WHERE m.role_name = current_user)`;
      await sql.unsafe(`
        CREATE POLICY chronicle_own_rows ON ${tbl}
        USING (${idCol} = ${owner})
        WITH CHECK (${idCol} = ${owner})`);
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
      people: Object.fromEntries(Object.entries(secrets)
        .filter(([, s]) => !s.service)
        .map(([userId, s]) => [userId, {
          app_role: s.app.role,
          app_connection_string: s.app.reuse ? s.app.known : conn(s.app.role, s.app.password),
          admin_role: s.admin.role,
          admin_connection_string: s.admin.reuse ? s.admin.known : conn(s.admin.role, s.admin.password),
        }])),
      services: Object.fromEntries(Object.entries(secrets)
        .filter(([, s]) => s.service)
        .map(([userId, s]) => [userId, {
          app_role: s.app.role,
          app_connection_string: s.app.reuse ? s.app.known : conn(s.app.role, s.app.password),
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
