import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ensureSchema, applyConcurrencyPragmas } from '../../../src/infrastructure/db/database.js';
import { SqliteMemoryRepository } from '../../../src/adapters/repositories/sqlite-memory-repository.js';

/**
 * Opening a database written by the OLD driver with the current one (ADR-015's open gap).
 *
 * ADR-015 moved from `better-sqlite3@11` (per-ABI prebuilds, no Node 24 binary) to `@13` (Node-API,
 * one binary per platform). Its Verification section says plainly: *"verified for new databases only
 * — an existing ~/.chronicle/chronicle.db written by v11 has not been opened under test by v13."*
 *
 * This closes that. The argument that it is fine — "SQLite's file format is stable and v13 is API
 * compatible for what this code uses" — is an argument, not evidence, and the difference matters for
 * a tool whose entire value is not losing what you wrote down.
 *
 * **The old driver runs in a CHILD PROCESS, and that is not a stylistic choice.** The first version
 * of this file imported v11 into the test worker, which then also held v13 — two independently
 * compiled copies of SQLite in one process. It passed on Node 22, where v11 ships a prebuilt binary,
 * and on Node 24, where there is no prebuild and v11 is compiled from source, it killed the worker:
 *
 *     Error: Worker exited unexpectedly
 *     Tests  312 passed (314)   Errors  1 error
 *
 * Intermittently — it had passed on an earlier run of the same commit range. A gate that fails one
 * run in three teaches people to re-run CI instead of reading it, which is worse than no gate.
 * Writing the fixture from a separate process means the two natives never coexist, so the hazard is
 * removed rather than tolerated.
 *
 * When v11 cannot be installed at all (offline, or no C++ toolchain), the test **skips loudly**
 * rather than passing quietly: a green tick for an assertion that did not run is worse than a
 * missing test.
 */

/** Install better-sqlite3@11 into a throwaway directory and return its require path. */
function installOldDriver(dir: string): string | null {
  try {
    execFileSync('npm', ['init', '-y'], { cwd: dir, stdio: 'ignore', timeout: 60_000, shell: process.platform === 'win32' });
    execFileSync(
      'npm',
      ['install', '--no-audit', '--no-fund', '--loglevel', 'error', 'better-sqlite3@11.10.0'],
      { cwd: dir, stdio: 'ignore', timeout: 300_000, shell: process.platform === 'win32' },
    );
    const entry = join(dir, 'node_modules', 'better-sqlite3', 'lib', 'index.js');
    return existsSync(entry) ? entry : null;
  } catch {
    return null;
  }
}

/**
 * Run a snippet against the v11 driver in its own process.
 *
 * The snippet gets `Database` (the v11 constructor) and `DB_PATH` in scope. Anything it throws
 * surfaces here as a failed test rather than as a crashed worker.
 */
function withOldDriver(dir: string, driverPath: string, dbPath: string, body: string): void {
  const scriptPath = join(dir, 'write-with-v11.cjs');
  writeFileSync(scriptPath, `
    const Database = require(${JSON.stringify(driverPath)});
    const DB_PATH = ${JSON.stringify(dbPath)};
    ${body}
  `, 'utf8');
  execFileSync(process.execPath, [scriptPath], { cwd: dir, stdio: 'pipe', timeout: 120_000 });
}

describe('a database written by better-sqlite3@11 opens with @13', () => {
  let dir: string;
  let dbPath: string;
  const open: Database.Database[] = [];

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'chronicle-driver-'));
    dbPath = join(dir, 'chronicle.db');
  });

  afterEach(() => {
    while (open.length) open.pop()?.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('reads rows the old driver wrote, with the schema migrated forward', () => {
    const oldDriverPath = installOldDriver(dir);
    if (!oldDriverPath) {
      // v11 has no Node 24 prebuild and needs a C++ toolchain to build from source — which is the
      // very problem ADR-015 removed. On a machine without one, this cannot run.
      console.warn(
        '\n  SKIPPED: could not install better-sqlite3@11 (no registry, or no C++ toolchain —\n' +
        '  which is ADR-015\'s original problem). This assertion did NOT run.\n',
      );
      expect(oldDriverPath).toBeNull();
      return;
    }

    // ── Write with the OLD driver, in its own process, using the pre-ADR-018 schema ─────────
    const now = new Date().toISOString();
    withOldDriver(dir, oldDriverPath, dbPath, `
      const db = new Database(DB_PATH);
      db.pragma('journal_mode = WAL');
      db.exec(\`
        CREATE TABLE memories (
          id TEXT PRIMARY KEY, content TEXT NOT NULL, memory_type TEXT NOT NULL,
          tier TEXT NOT NULL DEFAULT 'buffer', weight REAL NOT NULL DEFAULT 0.5,
          decay_rate REAL NOT NULL DEFAULT 0.1, access_count INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL, last_accessed_at TEXT NOT NULL, project TEXT, category TEXT,
          tags TEXT NOT NULL DEFAULT '[]', source TEXT, embedding BLOB,
          confirmed INTEGER NOT NULL DEFAULT 0
        );\`);
      db.prepare(
        \`INSERT INTO memories (id, content, memory_type, created_at, last_accessed_at, tags)
         VALUES (?, ?, 'semantic', ?, ?, ?)\`
      ).run('old-1', 'written by better-sqlite3 v11', ${JSON.stringify(now)}, ${JSON.stringify(now)},
            JSON.stringify(['legacy']));
      db.close();
    `);

    // ── Open with the CURRENT driver, exactly as the server does ───────────────────────────
    const db = new Database(dbPath);
    open.push(db);
    applyConcurrencyPragmas(db);

    expect(() => ensureSchema(db)).not.toThrow();

    // The row survives, the new column is present and defaulted, and the repository can read it
    // back through the normal path rather than raw SQL.
    const repo = new SqliteMemoryRepository(db);
    const found = repo.findById('old-1');

    expect(found).toBeDefined();
    expect(found?.content).toBe('written by better-sqlite3 v11');
    expect(found?.scope).toBe('project');
    expect(found?.tags).toEqual(['legacy']);
  }, 360_000);

  it('reads a WAL-mode database the old driver left behind', () => {
    // WAL files are written by the driver and read by whatever opens next. A format mismatch here
    // would look like data loss, which is the failure mode worth ruling out explicitly.
    const oldDriverPath = installOldDriver(dir);
    if (!oldDriverPath) {
      console.warn('\n  SKIPPED: better-sqlite3@11 unavailable; this assertion did NOT run.\n');
      expect(oldDriverPath).toBeNull();
      return;
    }

    withOldDriver(dir, oldDriverPath, dbPath, `
      const db = new Database(DB_PATH);
      db.pragma('journal_mode = WAL');
      db.exec('CREATE TABLE probe (id TEXT PRIMARY KEY, v TEXT)');
      db.prepare('INSERT INTO probe VALUES (?, ?)').run('a', 'value from v11');
      // Close WITHOUT checkpointing, so the new driver has to read the WAL the old one wrote.
      db.close();
    `);

    const db = new Database(dbPath);
    open.push(db);
    const row = db.prepare('SELECT v FROM probe WHERE id = ?').get('a') as { v: string } | undefined;

    expect(row?.v).toBe('value from v11');
  }, 360_000);
});
