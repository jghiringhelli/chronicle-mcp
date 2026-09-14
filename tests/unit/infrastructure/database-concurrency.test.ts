import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyConcurrencyPragmas } from '../../../src/infrastructure/db/database.js';
import { SCHEMA_SQL } from '../../../src/infrastructure/db/schema.js';

/**
 * Multi-process access (ADR-016).
 *
 * A developer running several Claude Code instances has several Chronicle servers open on the
 * same ~/.chronicle/chronicle.db. These tests use two real connections to one real file —
 * `:memory:` cannot express the behaviour at all, because each in-memory database is private to
 * its connection. That is why nothing pinned this contract before: the existing repository tests
 * all use `:memory:`, where cross-process access is not representable.
 *
 * Note on what was actually wrong: nothing. WAL was already set, and better-sqlite3 already
 * defaults busy_timeout to 5s. The gap was that no test pinned any of it, so the pragma line
 * could have been deleted as redundant startup noise and every gate would still have passed.
 */
describe('database concurrency pragmas', () => {
  let dir: string;
  let dbPath: string;
  const open: Database.Database[] = [];

  const connect = (): Database.Database => {
    const db = new Database(dbPath);
    applyConcurrencyPragmas(db);
    open.push(db);
    return db;
  };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'chronicle-concurrency-'));
    dbPath = join(dir, 'chronicle.db');
  });

  afterEach(() => {
    while (open.length > 0) open.pop()?.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('switches a file database off the default rollback journal and onto WAL', () => {
    // This is the one that can actually fail. A file database opens with
    // `journal_mode = delete`, where a reader blocks the writer — so without WAL the second
    // Claude Code instance contends with the first. The test asserts the mode changed from the
    // default, not merely that some mode is set.
    const raw = new Database(join(dir, 'raw.db'));
    open.push(raw);
    expect(raw.pragma('journal_mode', { simple: true })).toBe('delete');

    const a = connect();
    expect(a.pragma('journal_mode', { simple: true })).toBe('wal');
  });

  it('sets busy_timeout explicitly rather than inheriting the driver default', () => {
    // better-sqlite3 already defaults to 5000ms, so this cannot fail today. It is here because
    // the value is load-bearing for multi-instance use and a driver default is not a contract:
    // if a future better-sqlite3 changes it, this test is what notices.
    const a = connect();
    expect(a.pragma('busy_timeout', { simple: true })).toBe(5000);
  });

  it('relaxes synchronous to NORMAL, which is safe under WAL', () => {
    // SQLite's default is FULL (2); NORMAL (1) is the deliberate choice, so this one fails if
    // the pragma is dropped.
    const a = connect();
    expect(a.pragma('synchronous', { simple: true })).toBe(1);
  });

  it('keeps foreign keys enforced on every connection, not just the first', () => {
    connect();
    const b = connect();
    expect(b.pragma('foreign_keys', { simple: true })).toBe(1);
  });

  it('lets a second connection read a row the first one committed', () => {
    const writer = connect();
    writer.exec(SCHEMA_SQL);
    const now = new Date().toISOString();
    writer.prepare(
      `INSERT INTO memories (id, content, memory_type, tier, weight, decay_rate,
         access_count, created_at, last_accessed_at, tags)
       VALUES (?, ?, 'semantic', 'working', 0.5, 0.02, 0, ?, ?, '[]')`,
    ).run('m-1', 'written by instance A', now, now);

    const reader = connect();
    const row = reader.prepare('SELECT content FROM memories WHERE id = ?').get('m-1') as
      | { content: string }
      | undefined;

    expect(row?.content).toBe('written by instance A');
  });

  it('lets a second connection write while the first holds an open read', () => {
    const a = connect();
    a.exec(SCHEMA_SQL);
    const b = connect();

    // A keeps a read cursor open — under WAL this must not block B's write.
    const cursor = a.prepare('SELECT id FROM memories').iterate();
    cursor.next();

    const now = new Date().toISOString();
    const write = (): void => {
      b.prepare(
        `INSERT INTO memories (id, content, memory_type, tier, weight, decay_rate,
           access_count, created_at, last_accessed_at, tags)
         VALUES (?, ?, 'episodic', 'buffer', 0.5, 0.10, 0, ?, ?, '[]')`,
      ).run('m-2', 'written by instance B', now, now);
    };

    expect(write).not.toThrow();
    cursor.return?.();
  });

  it('applies the schema idempotently, so every instance may run it at startup', () => {
    const a = connect();
    a.exec(SCHEMA_SQL);

    // Each Chronicle process execs the schema when it opens the database. The second one must
    // be a no-op, not an error — otherwise the second Claude Code instance cannot start.
    const b = connect();
    expect(() => b.exec(SCHEMA_SQL)).not.toThrow();
  });
});
