/**
 * SQLite database singleton for Chronicle.
 *
 * One process per AI session, many sessions at once: a developer running several Claude Code
 * instances has several Chronicle servers open on the SAME file (~/.chronicle/chronicle.db).
 * `applyConcurrencyPragmas` is what makes that safe, and ADR-016 is where it is committed to as
 * a supported contract rather than left as an accident.
 */

import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { SCHEMA_TABLES_SQL, SCHEMA_INDEXES_SQL, SCHEMA_VERSION } from './schema.js';
import { getConfig } from '../../shared/config/index.js';
import { StorageError } from '../../shared/exceptions/index.js';

let _db: Database.Database | null = null;

/**
 * How long a write waits for a competing writer before giving up, in milliseconds.
 *
 * This matches better-sqlite3's own default, and is set explicitly rather than inherited: the
 * value is load-bearing for multi-instance use (ADR-016), and a driver default is not a contract.
 * Chronicle's writes are single-statement and sub-millisecond, so 5s absorbs a neighbouring
 * instance's session-end decay pass without ever being reached in normal use.
 */
const BUSY_TIMEOUT_MS = 5_000;

/**
 * Apply the pragmas that make concurrent multi-process access safe (ADR-016).
 *
 * Exported so tests can assert the contract against a real file database rather than trusting
 * that `getDatabase()` remembered to call it. Nothing previously pinned these, so removing
 * `journal_mode = WAL` would have passed every gate while breaking every second instance.
 *
 * @param db - An open database handle
 */
export function applyConcurrencyPragmas(db: Database.Database): void {
  // THE load-bearing pragma. A file database defaults to `journal_mode = delete`, where a reader
  // blocks the writer; under WAL neither blocks the other, so one instance recalling while
  // another remembers is not a conflict. Without this, multi-instance use does not work.
  db.pragma('journal_mode = WAL');
  // Explicit rather than inherited from the driver — see BUSY_TIMEOUT_MS.
  db.pragma(`busy_timeout = ${BUSY_TIMEOUT_MS}`);
  // Changed from the SQLite default (FULL). Safe under WAL: a power loss can cost the last
  // commit, never the file. Chronicle stores memories, not money — an fsync per transaction is
  // not worth it when a neighbouring instance may be mid-decay-pass.
  db.pragma('synchronous = NORMAL');
  // Also the driver default; stated for the same reason as busy_timeout.
  db.pragma('foreign_keys = ON');
}

/**
 * Get (or create) the singleton SQLite database connection.
 *
 * @returns Opened Database instance
 * @throws {StorageError} If the database cannot be opened
 */
export function getDatabase(): Database.Database {
  if (_db) return _db;

  try {
    const config = getConfig();
    const dbDir = path.dirname(config.dbPath);
    fs.mkdirSync(dbDir, { recursive: true });

    _db = new Database(config.dbPath);
    applyConcurrencyPragmas(_db);
    ensureSchema(_db);
    return _db;
  } catch (err) {
    throw new StorageError('Failed to open database', err);
  }
}

/**
 * Bring the database to the current schema, skipping the DDL when it is already there.
 *
 * Why the skip: every start used to run ~36 `CREATE ... IF NOT EXISTS` statements. They are cheap
 * individually and not free in aggregate, and cold start is an NFR (spec §5 NFR-02, budget 200ms) on
 * a process that is spawned once per AI session — often several at a time.
 * `PRAGMA user_version` is a single integer read in the file header, so the common path becomes one
 * read instead of three dozen statements.
 *
 * The hazard this introduces is obvious and is closed by a test: change the schema, forget to bump
 * `SCHEMA_VERSION`, and the DDL is skipped so the change never lands. `schema.test.ts` asserts the
 * version against a fingerprint of the schema text, so forgetting fails the build rather than
 * shipping a database that quietly lacks a table.
 *
 * Order within the apply path matters and is not cosmetic: tables, then column migrations, then
 * indexes. `CREATE TABLE IF NOT EXISTS` does nothing to a table that already exists, so a new column
 * needs an ALTER — and an index on that column cannot be created before it is there.
 *
 * @param db - An open database handle
 * @returns true when the schema was applied, false when it was already current
 */
export function ensureSchema(db: Database.Database): boolean {
  const [row] = db.pragma('user_version') as Array<{ user_version: number }>;
  if (row?.user_version === SCHEMA_VERSION) return false;

  db.exec(SCHEMA_TABLES_SQL);
  migrateLocalSchema(db);
  db.exec(SCHEMA_INDEXES_SQL);
  // Only after everything succeeded: a version stamped before a failed migration would make the next
  // start skip the work it still needs to do.
  db.pragma(`user_version = ${SCHEMA_VERSION}`);
  return true;
}

/**
 * Columns added to the local schema after a release, and the table each belongs to.
 *
 * SQLite has no migration runner here by design (ADR-001 accepted "manual migration scripts
 * required if schema changes"), so this is that, inlined and idempotent: every entry is checked
 * against `PRAGMA table_info` and added only when missing.
 *
 * Each entry MUST have a DEFAULT or be nullable. An existing row has to remain valid — there is no
 * opportunity to backfill before the column exists.
 */
const COLUMN_MIGRATIONS: ReadonlyArray<{
  table: string;
  column: string;
  definition: string;
  why: string;
}> = [
  {
    table: 'memories',
    column: 'scope',
    definition: "TEXT NOT NULL DEFAULT 'project'",
    why: "ADR-018 §1 — three explicit scopes. 'project' is what an unscoped row meant.",
  },
  {
    table: 'contributors',
    column: 'kind',
    definition: "TEXT NOT NULL DEFAULT 'human'",
    why: 'A contributor can be an AI session. Every existing row is a person.',
  },
  {
    table: 'contributors',
    column: 'repo_path',
    definition: 'TEXT',
    why: 'Where a session contributor works. Null for a person.',
  },
];

/**
 * Bring an existing database up to the current column set.
 *
 * Idempotent and additive: it adds missing columns and never drops or rewrites one. Exported so a
 * test can run it against a deliberately-old database rather than trusting that startup does.
 *
 * This exists because of a real break: adding `memories.scope` to the schema file made the server
 * fail to start on every database that already existed, with `no such column: scope` — the index on
 * the new column was created before anything added the column. A schema file describes a fresh
 * database; a migration is what an existing one needs.
 *
 * @param db - An open database with the tables already created
 * @returns The columns it added, for logging and tests
 */
export function migrateLocalSchema(db: Database.Database): string[] {
  const added: string[] = [];
  for (const m of COLUMN_MIGRATIONS) {
    const cols = db.prepare(`PRAGMA table_info(${m.table})`).all() as Array<{ name: string }>;
    // An absent table is not a migration failure: the tables pass creates it, and a table this
    // build does not know about is not this function's business.
    if (cols.length === 0) continue;
    if (cols.some((c) => c.name === m.column)) continue;
    db.exec(`ALTER TABLE ${m.table} ADD COLUMN ${m.column} ${m.definition}`);
    added.push(`${m.table}.${m.column}`);
  }
  return added;
}

/**
 * Close the database connection.
 */
export function closeDatabase(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}
