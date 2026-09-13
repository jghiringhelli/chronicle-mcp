import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  SCHEMA_TABLES_SQL, SCHEMA_INDEXES_SQL, SCHEMA_VERSION,
} from '../../../src/infrastructure/db/schema.js';
import { ensureSchema, applyConcurrencyPragmas } from '../../../src/infrastructure/db/database.js';

/**
 * The schema-version gate.
 *
 * Startup skips ~36 `CREATE ... IF NOT EXISTS` statements when `PRAGMA user_version` already matches
 * `SCHEMA_VERSION`, because cold start is an NFR (spec §5 NFR-02) on a process spawned once per AI
 * session. The skip introduces one hazard: change the schema, forget to bump the version, and the DDL
 * never runs, so the change silently never lands.
 *
 * The fingerprint test below is what makes that hazard unreachable. It is deliberately annoying —
 * editing the schema fails the build until the version is bumped — because the alternative is a
 * database that quietly lacks a table nobody notices until a query fails in production.
 */
describe('schema version', () => {
  /**
   * Fingerprint of the schema text, mapped to the version that must accompany it.
   *
   * When this test fails after a schema change, bump `SCHEMA_VERSION`, add any new column to
   * `COLUMN_MIGRATIONS`, and update the hash below to the one the failure prints.
   */
  const EXPECTED = {
    version: 1,
    // sha256 of `${SCHEMA_TABLES_SQL}${SCHEMA_INDEXES_SQL}`, first 16 hex chars.
    fingerprint: 'ac47cec0c82e0710',
  };

  it('matches the schema it was stamped for', () => {
    const actual = createHash('sha256')
      .update(SCHEMA_TABLES_SQL + SCHEMA_INDEXES_SQL)
      .digest('hex')
      .slice(0, 16);

    // The first run records the fingerprint; thereafter a mismatch means the schema moved.
    if (EXPECTED.fingerprint === '') {
      // Deliberately not a silent pass: print the value to paste in, and assert the version is at
      // least plausible so the test still means something on the very first run.
      console.log(`\n  schema fingerprint: ${actual}  (paste into EXPECTED.fingerprint)\n`);
      expect(SCHEMA_VERSION).toBeGreaterThanOrEqual(1);
      return;
    }

    expect(
      actual,
      `The schema text changed but SCHEMA_VERSION is still ${SCHEMA_VERSION}.\n` +
      `  Bump SCHEMA_VERSION, add any new column to COLUMN_MIGRATIONS in database.ts,\n` +
      `  then set EXPECTED.fingerprint to "${actual}".\n` +
      `  Without the bump, startup SKIPS the DDL and your change never applies.`,
    ).toBe(EXPECTED.fingerprint);
    expect(SCHEMA_VERSION).toBe(EXPECTED.version);
  });
});

describe('ensureSchema', () => {
  let dir: string;
  const open: Database.Database[] = [];

  const openDb = (file = 'chronicle.db') => {
    const db = new Database(join(dir, file));
    applyConcurrencyPragmas(db);
    open.push(db);
    return db;
  };

  const version = (db: Database.Database) =>
    (db.pragma('user_version') as Array<{ user_version: number }>)[0]!.user_version;

  const tableNames = (db: Database.Database) =>
    (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>)
      .map((r) => r.name);

  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'chronicle-schema-')); });
  afterEach(() => {
    while (open.length) open.pop()?.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('applies the schema to a new database and stamps the version', () => {
    const db = openDb();

    expect(ensureSchema(db)).toBe(true);
    expect(version(db)).toBe(SCHEMA_VERSION);
    expect(tableNames(db)).toContain('memories');
  });

  it('skips the work on a database that is already current', () => {
    const db = openDb();
    ensureSchema(db);

    // The whole point of the gate: the second call does nothing.
    expect(ensureSchema(db)).toBe(false);
  });

  it('re-applies when the stamped version is older', () => {
    const db = openDb();
    ensureSchema(db);
    db.pragma('user_version = 0');

    expect(ensureSchema(db)).toBe(true);
    expect(version(db)).toBe(SCHEMA_VERSION);
  });

  it('leaves the version unstamped if applying throws', () => {
    // A version stamped before a failed migration would make the next start skip work it still
    // needs. Simulated by making a required table name unavailable as a view.
    const db = openDb('broken.db');
    db.exec('CREATE VIEW memories AS SELECT 1 AS x');

    expect(() => ensureSchema(db)).toThrow();
    expect(version(db)).toBe(0);
  });

  it('creates every table the application reads', () => {
    const db = openDb();
    ensureSchema(db);

    const names = tableNames(db);
    for (const required of [
      'memories', 'sessions', 'triggers', 'preferences', 'solutions', 'insights', 'sync_cursor',
      'contributors', 'work_packages', 'merge_requests', 'assignments',
      'team_shared_cache', 'team_insights_cache', 'team_patterns_cache', 'prompt_log_buffer',
    ]) {
      expect(names, `${required} is missing from the schema`).toContain(required);
    }
  });

  it('creates the indexes recall depends on', () => {
    const db = openDb();
    ensureSchema(db);

    const indexes = (db.prepare("SELECT name FROM sqlite_master WHERE type='index'").all() as
      Array<{ name: string }>).map((r) => r.name);

    // Scope is in every recall predicate since ADR-018, so this index is on the hot path.
    expect(indexes).toContain('idx_memories_scope');
    expect(indexes).toContain('idx_memories_weight');
  });

  it('is safe to call from two connections to the same file', () => {
    // Every Chronicle process calls this at startup, and several run at once (ADR-016).
    const a = openDb();
    const b = openDb();

    expect(ensureSchema(a)).toBe(true);
    expect(() => ensureSchema(b)).not.toThrow();
    expect(version(b)).toBe(SCHEMA_VERSION);
  });
});
