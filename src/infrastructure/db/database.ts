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
import { SCHEMA_SQL } from './schema.js';
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
    _db.exec(SCHEMA_SQL);
    return _db;
  } catch (err) {
    throw new StorageError('Failed to open database', err);
  }
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
