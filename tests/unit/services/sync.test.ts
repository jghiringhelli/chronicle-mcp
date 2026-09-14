import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { SCHEMA_SQL } from '../../../src/infrastructure/db/schema.js';

/**
 * Cloud sync (EDR-003, ADR-010).
 *
 * 522 lines with zero tests before this file. EDR-003's Verification section names the five
 * assertions; the first is the one that protects every local-only install, which is most of them.
 *
 * `getConfig` and `getDatabase` are module singletons reading ~/.chronicle, so they are stubbed
 * at the module boundary rather than by refactoring two untested units (RM-102 scope: tests
 * first, typed rows and injection later).
 */

const dbHolder: { db: Database.Database | null } = { db: null };
const configHolder: { config: Record<string, unknown> } = { config: {} };

vi.mock('../../../src/shared/config/index.js', () => ({
  getConfig: () => configHolder.config,
}));

vi.mock('../../../src/infrastructure/db/database.js', () => ({
  getDatabase: () => dbHolder.db,
}));

/** Records every statement a push would have sent, without a network. */
const sent: string[] = [];
const fakeSql = Object.assign(
  (strings: TemplateStringsArray, ..._values: unknown[]) => {
    sent.push(strings.join('?').replace(/\s+/g, ' ').trim());
    return Promise.resolve([]);
  },
  { end: () => Promise.resolve() },
);

vi.mock('postgres', () => ({ default: () => fakeSql }));

const { syncMemories, syncInsights, syncCoordination } =
  await import('../../../src/services/sync.js');

const insertMemory = (db: Database.Database, id: string, tier: string, lastAccessed: string) => {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO memories (id, content, memory_type, tier, weight, decay_rate, access_count,
       created_at, last_accessed_at, project, tags)
     VALUES (?, ?, 'semantic', ?, 0.5, 0.02, 1, ?, ?, 'my-app', '[]')`,
  ).run(id, `content of ${id}`, tier, now, lastAccessed);
};

describe('cloud sync', () => {
  beforeEach(() => {
    sent.length = 0;
    dbHolder.db = new Database(':memory:');
    dbHolder.db.exec(SCHEMA_SQL);
    configHolder.config = {
      userId: 'user@example.com',
      deviceId: 'device-A',
      dbPath: ':memory:',
      // railwayUrl and teamId deliberately absent — the default state of most installs.
    };
  });

  afterEach(() => {
    dbHolder.db?.close();
    dbHolder.db = null;
  });

  // ── EDR-003 assertion 1: absence of configuration is a normal state, not an error ──────────

  describe('unconfigured is a normal state', () => {
    it('skips syncMemories with no railwayUrl, and does not throw', async () => {
      const result = await syncMemories();

      expect(result).toEqual({ pushed: 0, pulled: 0, conflicts: 0, skipped: true });
    });

    it('skips syncInsights with no railwayUrl', async () => {
      expect((await syncInsights()).skipped).toBe(true);
    });

    it('skips syncCoordination with no railwayUrl', async () => {
      expect((await syncCoordination()).skipped).toBe(true);
    });

    it('skips syncCoordination when railwayUrl is set but teamId is not', async () => {
      // The team layer needs both. A personal install with cloud sync enabled must not start
      // pushing coordination state it has none of (ADR-010 §3).
      configHolder.config = { ...configHolder.config, railwayUrl: 'postgres://localhost/test' };

      expect((await syncCoordination()).skipped).toBe(true);
    });

    it('sends nothing at all while unconfigured', async () => {
      await syncMemories();
      await syncInsights();
      await syncCoordination();

      expect(sent).toHaveLength(0);
    });

    it('leaves local rows untouched while unconfigured', async () => {
      insertMemory(dbHolder.db!, 'm-1', 'working', new Date().toISOString());

      await syncMemories();

      const row = dbHolder.db!.prepare('SELECT synced_at FROM memories WHERE id = ?').get('m-1') as
        | { synced_at: string | null }
        | undefined;
      expect(row?.synced_at).toBeNull();
    });
  });

  // ── EDR-003 assertion 4: buffer-tier memories are never pushed ─────────────────────────────

  describe('what is eligible to push', () => {
    beforeEach(() => {
      configHolder.config = { ...configHolder.config, railwayUrl: 'postgres://localhost/test' };
    });

    it('pushes working and core memories but never buffer ones', async () => {
      const past = new Date(Date.now() - 60_000).toISOString();
      insertMemory(dbHolder.db!, 'm-working', 'working', past);
      insertMemory(dbHolder.db!, 'm-core', 'core', past);
      insertMemory(dbHolder.db!, 'm-buffer', 'buffer', past);

      const result = await syncMemories();

      // Buffer is ephemeral by definition; pushing it would make every device pay for another
      // device's scratch state.
      expect(result.pushed).toBe(2);
      expect(result.skipped).toBe(false);
    });

    it('marks pushed rows as synced', async () => {
      insertMemory(dbHolder.db!, 'm-1', 'core', new Date(Date.now() - 60_000).toISOString());

      await syncMemories();

      const row = dbHolder.db!.prepare('SELECT synced_at FROM memories WHERE id = ?').get('m-1') as
        { synced_at: string | null };
      expect(row.synced_at).not.toBeNull();
    });

    it('reports zero pushed when there is nothing eligible', async () => {
      insertMemory(dbHolder.db!, 'm-buffer', 'buffer', new Date().toISOString());

      expect((await syncMemories()).pushed).toBe(0);
    });
  });

  // ── EDR-003 assertion 5: the cursor ────────────────────────────────────────────────────────

  describe('the sync cursor', () => {
    beforeEach(() => {
      configHolder.config = { ...configHolder.config, railwayUrl: 'postgres://localhost/test' };
    });

    it('creates a cursor for the device on the first run', async () => {
      await syncMemories();

      const cursor = dbHolder.db!.prepare(
        'SELECT device_id, user_id FROM sync_cursor WHERE device_id = ?',
      ).get('device-A') as { device_id: string; user_id: string } | undefined;

      expect(cursor?.device_id).toBe('device-A');
      expect(cursor?.user_id).toBe('user@example.com');
    });

    it('keeps exactly one cursor row per device across repeated runs', async () => {
      await syncMemories();
      await syncMemories();
      await syncMemories();

      const { n } = dbHolder.db!.prepare(
        'SELECT COUNT(*) as n FROM sync_cursor WHERE device_id = ?',
      ).get('device-A') as { n: number };

      expect(n).toBe(1);
    });

    it('advances the version on each pass, so the cursor is observably moving', async () => {
      await syncMemories();
      const first = dbHolder.db!.prepare(
        'SELECT memories_version FROM sync_cursor WHERE device_id = ?',
      ).get('device-A') as { memories_version: number };

      await syncMemories();
      const second = dbHolder.db!.prepare(
        'SELECT memories_version FROM sync_cursor WHERE device_id = ?',
      ).get('device-A') as { memories_version: number };

      expect(second.memories_version).toBeGreaterThan(first.memories_version);
    });

    it('uses an epoch floor on the first run, so nothing is silently skipped', async () => {
      insertMemory(dbHolder.db!, 'm-ancient', 'core', '1999-01-01T00:00:00.000Z');

      // A first run has no cursor; EDR-003 says it falls back to 1970 and does a full sync.
      // An old row must therefore still be pushed rather than filtered out.
      expect((await syncMemories()).pushed).toBe(1);
    });
  });

  // ── Reported shape ────────────────────────────────────────────────────────────────────────

  describe('the SyncResult contract', () => {
    it('always reports conflicts as 0 — it is not a signal', async () => {
      configHolder.config = { ...configHolder.config, railwayUrl: 'postgres://localhost/test' };
      insertMemory(dbHolder.db!, 'm-1', 'core', new Date(Date.now() - 60_000).toISOString());

      const result = await syncMemories();

      // EDR-003 records this explicitly: discards happen inside the SQL WHERE on push and in a
      // `continue` on pull, neither of which increments anything. Do not build an alert on it.
      expect(result.conflicts).toBe(0);
    });

    it('returns every field of SyncResult on both the skipped and the active path', async () => {
      const skippedResult = await syncMemories();
      configHolder.config = { ...configHolder.config, railwayUrl: 'postgres://localhost/test' };
      const activeResult = await syncMemories();

      for (const r of [skippedResult, activeResult]) {
        expect(r).toHaveProperty('pushed');
        expect(r).toHaveProperty('pulled');
        expect(r).toHaveProperty('conflicts');
        expect(r).toHaveProperty('skipped');
      }
    });
  });
});
