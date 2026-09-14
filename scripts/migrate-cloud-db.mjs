#!/usr/bin/env node
/**
 * Idempotent, additive migrations for the cloud mirror.
 *
 * `scripts/init-cloud-db.ts` applies the schema to an empty database. This applies *changes* to one
 * that already holds data — which the live Railway database does: a team, two members, a licence, a
 * shared memory and a prompt log, all written in May.
 *
 * Rules this script holds itself to:
 *   - **Additive only.** It adds columns and indexes. It never drops or rewrites data. A destructive
 *     migration belongs in a reviewed, separately-named script, not in the one people run casually.
 *   - **Idempotent.** Safe to run repeatedly; it reports what it changed and what was already there.
 *   - **Dry by default.** Without `--apply` it prints the plan and touches nothing.
 *
 * Usage:
 *   CHRONICLE_CLOUD_URL="postgres://…" node scripts/migrate-cloud-db.mjs          # plan only
 *   CHRONICLE_CLOUD_URL="postgres://…" node scripts/migrate-cloud-db.mjs --apply
 */

import postgres from 'postgres';

const url = process.env['CHRONICLE_CLOUD_URL'] ?? process.env['DATABASE_PUBLIC_URL'];
const APPLY = process.argv.includes('--apply');
/**
 * `--only <id,id>` restricts the run. It exists so the additive migrations can be applied without
 * the destructive one: a column drop on a database shared with another person is a decision, not a
 * step, and it should not ride along with an index creation.
 */
const ONLY = (() => {
  const i = process.argv.indexOf('--only');
  return i === -1 ? null : new Set((process.argv[i + 1] ?? '').split(',').map((s) => s.trim()).filter(Boolean));
})();
/** Destructive migrations require naming themselves explicitly via --only. */
const ALLOW_DESTRUCTIVE = process.argv.includes('--allow-destructive');

if (!url) { console.error('Set CHRONICLE_CLOUD_URL.'); process.exit(1); }

const sql = postgres(url, { max: 1, idle_timeout: 5, connect_timeout: 15, onnotice: () => {} });

/**
 * Each migration names itself, decides whether it is needed, and applies itself.
 * `needed` must be cheap and side-effect free — it runs in dry mode too.
 */
const migrations = [
  {
    id: '001-memories-scope',
    why: 'ADR-018 §1 — three explicit scopes. Defaulted to `project`, which is what an unscoped row meant.',
    async needed() {
      const [c] = await sql`
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='memories' AND column_name='scope'`;
      return !c;
    },
    async apply() {
      await sql`ALTER TABLE memories ADD COLUMN scope TEXT NOT NULL DEFAULT 'project'`;
    },
  },
  {
    id: '002-memories-user-scope-index',
    why: 'Scope is part of every personal pull predicate (ADR-018 §3), so it is on the hot path.',
    async needed() {
      const [i] = await sql`SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_memories_user_scope'`;
      return !i;
    },
    async apply() {
      await sql`CREATE INDEX idx_memories_user_scope ON memories(user_id, scope)`;
    },
  },
  {
    id: '003-drop-raw-prompt-content',
    why: 'ADR-019 §1 — Chronicle must not store raw prompt text. A flag is a promise; an absent column is a property.',
    destructive: true,
    async needed() {
      const cols = await sql`
        SELECT column_name FROM information_schema.columns
        WHERE table_schema='public' AND table_name='prompt_logs'
          AND column_name IN ('raw_content','share_content')`;
      return cols.length > 0;
    },
    async apply() {
      // Guard: refuse to drop if any row actually carries raw content. Measured zero when this was
      // written, and a migration that silently destroys data nobody checked for is the wrong shape.
      const [{ n }] = await sql`SELECT count(*)::int AS n FROM prompt_logs WHERE raw_content IS NOT NULL`;
      if (n > 0) {
        throw new Error(
          `${n} prompt_logs row(s) carry raw_content. Refusing to drop it automatically — ` +
          `export or delete those rows deliberately first (ADR-019).`,
        );
      }
      await sql`ALTER TABLE prompt_logs DROP COLUMN IF EXISTS raw_content`;
      await sql`ALTER TABLE prompt_logs DROP COLUMN IF EXISTS share_content`;
    },
  },
];

try {
  const target = new URL(url);
  console.log(`target: ${target.hostname}:${target.port}/${target.pathname.slice(1)}`);
  console.log(APPLY ? 'mode:   APPLY\n' : 'mode:   dry run (pass --apply to change anything)\n');

  let pending = 0;
  for (const m of migrations) {
    if (ONLY && !ONLY.has(m.id)) { console.log(`${m.id.padEnd(34)} skipped (not in --only)`); continue; }
    const need = await m.needed();
    const mark = need ? (m.destructive ? 'NEEDED (destructive)' : 'NEEDED') : 'already applied';
    console.log(`${m.id.padEnd(34)} ${mark}`);
    console.log(`  ${m.why}`);
    if (!need) continue;
    pending++;
    if (!APPLY) continue;
    if (m.destructive && !(ONLY?.has(m.id) && ALLOW_DESTRUCTIVE)) {
      console.log('  -> REFUSED: destructive. Name it with --only ' + m.id + ' --allow-destructive');
      continue;
    }
    try {
      await m.apply();
      console.log('  -> applied');
    } catch (err) {
      console.error('  -> FAILED: ' + (err instanceof Error ? err.message : String(err)));
      process.exitCode = 1;
    }
  }

  console.log(`\n${pending} migration(s) ${APPLY ? 'attempted' : 'pending'}.`);
  if (!APPLY && pending > 0) console.log('Re-run with --apply to make the changes.');
} catch (err) {
  console.error('migration aborted: ' + (err instanceof Error ? err.message : String(err)));
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
