/**
 * SQLite database singleton for Chronicle.
 */

import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { SCHEMA_SQL } from './schema.js';
import { getConfig } from '../../shared/config/index.js';
import { StorageError } from '../../shared/exceptions/index.js';

let _db: Database.Database | null = null;

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
    _db.pragma('journal_mode = WAL');
    _db.pragma('foreign_keys = ON');
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
