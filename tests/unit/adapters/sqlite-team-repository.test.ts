/**
 * Unit tests for SqliteTeamRepository — the local team-knowledge cache.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { SqliteTeamRepository } from '../../../src/adapters/repositories/sqlite-team-repository.js';
import { SCHEMA_SQL } from '../../../src/infrastructure/db/schema.js';
import { createPromptLog } from '../../../src/domain/entities/prompt-log.js';

function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.exec(SCHEMA_SQL);
  return db;
}

describe('SqliteTeamRepository', () => {
  let db: Database.Database;
  let repo: SqliteTeamRepository;

  beforeEach(() => {
    db = makeDb();
    repo = new SqliteTeamRepository(db);
  });

  const shared = (id: string, overrides: Partial<Parameters<SqliteTeamRepository['upsertSharedCache']>[0]> = {}) => ({
    id, userId: 'u1', teamId: 't1', project: 'proj-a',
    content: `content ${id}`, memoryType: 'semantic',
    tags: Object.freeze(['x']), category: undefined,
    sharedAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  });

  describe('shared cache', () => {
    it('upserts then finds a shared memory by content query', () => {
      repo.upsertSharedCache(shared('m1', { content: 'use vitest for testing' }));
      const found = repo.searchSharedCache('t1', 'vitest');
      expect(found).toHaveLength(1);
      expect(found[0]!.id).toBe('m1');
    });

    it('upsert is idempotent on id — replaces, never duplicates', () => {
      repo.upsertSharedCache(shared('m1', { content: 'first' }));
      repo.upsertSharedCache(shared('m1', { content: 'second' }));
      const all = repo.searchSharedCache('t1', '');
      expect(all).toHaveLength(1);
      expect(all[0]!.content).toBe('second');
    });

    it('empty query matches every entry for the team', () => {
      repo.upsertSharedCache(shared('m1'));
      repo.upsertSharedCache(shared('m2'));
      expect(repo.searchSharedCache('t1', '')).toHaveLength(2);
    });

    it('filters by project when provided', () => {
      repo.upsertSharedCache(shared('m1', { project: 'proj-a' }));
      repo.upsertSharedCache(shared('m2', { project: 'proj-b' }));
      const a = repo.searchSharedCache('t1', '', 'proj-a');
      expect(a).toHaveLength(1);
      expect(a[0]!.id).toBe('m1');
    });

    it('does not leak another team\'s memories', () => {
      repo.upsertSharedCache(shared('m1', { teamId: 't1' }));
      repo.upsertSharedCache(shared('m2', { teamId: 't2' }));
      expect(repo.searchSharedCache('t1', '')).toHaveLength(1);
    });

    it('honors the limit boundary', () => {
      for (let i = 0; i < 5; i++) repo.upsertSharedCache(shared(`m${i}`));
      expect(repo.searchSharedCache('t1', '', undefined, 2)).toHaveLength(2);
    });
  });

  describe('insights cache', () => {
    const insight = (id: string, project?: string) => ({
      id, teamId: 't1', project, insightType: 'practice' as const,
      content: `insight ${id}`, confidence: 0.7, sourceCount: 2, version: 1,
      updatedAt: '2026-01-01T00:00:00Z',
    });

    it('returns project-scoped and team-wide (null project) insights together', () => {
      repo.upsertInsight(insight('i1', 'proj-a'));
      repo.upsertInsight(insight('i2', undefined));
      repo.upsertInsight(insight('i3', 'proj-b'));
      const got = repo.getInsights('t1', 'proj-a');
      expect(got.map(i => i.id).sort()).toEqual(['i1', 'i2']);
    });

    it('orders by confidence descending', () => {
      repo.upsertInsight({ ...insight('lo'), confidence: 0.2 });
      repo.upsertInsight({ ...insight('hi'), confidence: 0.9 });
      const got = repo.getInsights('t1');
      expect(got[0]!.id).toBe('hi');
    });
  });

  describe('prompt log buffer', () => {
    it('buffers a log as pending, then marks it pushed', () => {
      const log = createPromptLog('log1', { userId: 'u1', teamId: 't1', pattern: 'fix a bug', outcome: 'good' });
      repo.bufferPromptLog(log);
      expect(repo.getPendingPromptLogs()).toHaveLength(1);
      repo.markPromptLogsPushed(['log1']);
      expect(repo.getPendingPromptLogs()).toHaveLength(0);
    });

    it('markPromptLogsPushed with empty list is a no-op', () => {
      const log = createPromptLog('log1', { userId: 'u1', teamId: 't1', pattern: 'x' });
      repo.bufferPromptLog(log);
      repo.markPromptLogsPushed([]);
      expect(repo.getPendingPromptLogs()).toHaveLength(1);
    });

    it('counts logs by outcome and category for a user', () => {
      repo.bufferPromptLog(createPromptLog('l1', { userId: 'u1', teamId: 't1', pattern: 'a', outcome: 'good', category: 'debugging' }));
      repo.bufferPromptLog(createPromptLog('l2', { userId: 'u1', teamId: 't1', pattern: 'b', outcome: 'bad', category: 'debugging' }));
      expect(repo.countPromptLogsByOutcome('u1', 't1')).toEqual({ good: 1, bad: 1 });
      expect(repo.countPromptLogsByCategory('u1', 't1')).toEqual({ debugging: 2 });
    });
  });

  describe('sync cursor', () => {
    it('returns undefined before any pull, then the set value', () => {
      expect(repo.getLastPullAt('u1', 't1')).toBeUndefined();
      repo.setLastPullAt('u1', 't1', '2026-05-01T00:00:00Z');
      expect(repo.getLastPullAt('u1', 't1')).toBe('2026-05-01T00:00:00Z');
    });

    it('overwrites the watermark on repeated set', () => {
      repo.setLastPullAt('u1', 't1', '2026-05-01T00:00:00Z');
      repo.setLastPullAt('u1', 't1', '2026-05-02T00:00:00Z');
      expect(repo.getLastPullAt('u1', 't1')).toBe('2026-05-02T00:00:00Z');
    });
  });
});
