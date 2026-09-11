import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { migrateLocalSchema, applyConcurrencyPragmas } from '../../../src/infrastructure/db/database.js';
import { SCHEMA_TABLES_SQL, SCHEMA_INDEXES_SQL } from '../../../src/infrastructure/db/schema.js';

/**
 * Local schema migration.
 *
 * Regression tests for a break I caused: adding `memories.scope` to the schema file made the server
 * fail to start on every database that already existed, with `no such column: scope`.
 * `CREATE TABLE IF NOT EXISTS` does nothing to a table that is already there, so the new column was
 * never added — and the new index on it was created anyway, which is what threw.
 *
 * A schema file describes a *fresh* database. An existing one needs a migration, and the order has to
 * be tables → migrations → indexes. These tests build a deliberately-old database to prove it,
 * because the only databases that can expose this class of bug are the ones that predate the change.
 */
describe('migrateLocalSchema', () => {
  let dir: string;
  const open: Database.Database[] = [];

  /** A `memories` table as it existed before ADR-018 — no `scope` column. */
  const OLD_MEMORIES = `
    CREATE TABLE memories (
      id TEXT PRIMARY KEY,
      content TEXT NOT NULL,
      memory_type TEXT NOT NULL,
      tier TEXT NOT NULL DEFAULT 'buffer',
      weight REAL NOT NULL DEFAULT 0.5,
      decay_rate REAL NOT NULL DEFAULT 0.1,
      access_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      last_accessed_at TEXT NOT NULL,
      project TEXT,
      category TEXT,
      tags TEXT NOT NULL DEFAULT '[]',
      source TEXT,
      embedding BLOB,
      confirmed INTEGER NOT NULL DEFAULT 0
    );`;

  const openDb = (file = 'chronicle.db') => {
    const db = new Database(join(dir, file));
    applyConcurrencyPragmas(db);
    open.push(db);
    return db;
  };

  const columns = (db: Database.Database, table: string) =>
    (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((c) => c.name);

  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'chronicle-migrate-')); });
  afterEach(() => {
    while (open.length) open.pop()?.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('adds a missing column to a table that already exists', () => {
    const db = openDb();
    db.exec(OLD_MEMORIES);
    expect(columns(db, 'memories')).not.toContain('scope');

    const added = migrateLocalSchema(db);

    expect(added).toContain('memories.scope');
    expect(columns(db, 'memories')).toContain('scope');
  });

  it('defaults existing rows rather than leaving them invalid', () => {
    // There is no chance to backfill before the column exists, so the DEFAULT is the contract.
    const db = openDb();
    db.exec(OLD_MEMORIES);
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO memories (id, content, memory_type, created_at, last_accessed_at)
       VALUES ('m-old', 'written before ADR-018', 'semantic', ?, ?)`,
    ).run(now, now);

    migrateLocalSchema(db);

    const row = db.prepare('SELECT scope FROM memories WHERE id = ?').get('m-old') as { scope: string };
    expect(row.scope).toBe('project');
  });

  it('is idempotent — a second run adds nothing and does not throw', () => {
    const db = openDb();
    db.exec(OLD_MEMORIES);
    migrateLocalSchema(db);

    expect(migrateLocalSchema(db)).toEqual([]);
    expect(() => migrateLocalSchema(db)).not.toThrow();
  });

  it('adds nothing to a database already created from the current schema', () => {
    const db = openDb();
    db.exec(SCHEMA_TABLES_SQL);

    expect(migrateLocalSchema(db)).toEqual([]);
  });

  it('does not fail on an empty database with no tables at all', () => {
    const db = openDb();

    expect(() => migrateLocalSchema(db)).not.toThrow();
    expect(migrateLocalSchema(db)).toEqual([]);
  });

  it('leaves the data in the migrated table intact', () => {
    const db = openDb();
    db.exec(OLD_MEMORIES);
    const now = new Date().toISOString();
    for (const id of ['a', 'b', 'c']) {
      db.prepare(
        `INSERT INTO memories (id, content, memory_type, created_at, last_accessed_at)
         VALUES (?, ?, 'semantic', ?, ?)`,
      ).run(id, `content ${id}`, now, now);
    }

    migrateLocalSchema(db);

    const rows = db.prepare('SELECT id, content FROM memories ORDER BY id').all() as
      Array<{ id: string; content: string }>;
    expect(rows.map((r) => r.id)).toEqual(['a', 'b', 'c']);
    expect(rows[0]?.content).toBe('content a');
  });

  describe('startup order: tables, then migrations, then indexes', () => {
    it('creating the indexes BEFORE the migration is what broke the server', () => {
      // The actual failure, reproduced: the index references a column the migration had not added.
      const db = openDb('wrong-order.db');
      db.exec(OLD_MEMORIES);

      expect(() => db.exec(SCHEMA_INDEXES_SQL)).toThrow(/no such column: scope/);
    });

    it('the correct order opens an old database cleanly', () => {
      const db = openDb('right-order.db');
      db.exec(OLD_MEMORIES);

      expect(() => {
        db.exec(SCHEMA_TABLES_SQL);
        migrateLocalSchema(db);
        db.exec(SCHEMA_INDEXES_SQL);
      }).not.toThrow();

      expect(columns(db, 'memories')).toContain('scope');
    });

    it('the correct order also works on a brand new database', () => {
      const db = openDb('fresh.db');

      expect(() => {
        db.exec(SCHEMA_TABLES_SQL);
        migrateLocalSchema(db);
        db.exec(SCHEMA_INDEXES_SQL);
      }).not.toThrow();
    });
  });
});
