/**
 * Unit tests for PatternService — usage aggregation over the local cache.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { PatternService } from '../../../src/services/pattern-service.js';
import { SqliteTeamRepository } from '../../../src/adapters/repositories/sqlite-team-repository.js';
import { SCHEMA_SQL } from '../../../src/infrastructure/db/schema.js';
import { createPromptLog } from '../../../src/domain/entities/prompt-log.js';

const { cfg } = vi.hoisted(() => ({
  cfg: { userId: 'u1', teamId: 't1', railwayUrl: undefined as string | undefined, deviceId: 'd1', dbPath: ':memory:' },
}));
vi.mock('../../../src/shared/config/index.js', () => ({ getConfig: () => cfg }));

function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.exec(SCHEMA_SQL);
  return db;
}

describe('PatternService.myStats', () => {
  let db: Database.Database;
  let repo: SqliteTeamRepository;
  let svc: PatternService;

  beforeEach(() => {
    db = makeDb();
    repo = new SqliteTeamRepository(db);
    svc = new PatternService(repo);
  });

  it('computes good rate from buffered prompt logs', () => {
    repo.bufferPromptLog(createPromptLog('l1', { userId: 'u1', teamId: 't1', pattern: 'a', outcome: 'good' }));
    repo.bufferPromptLog(createPromptLog('l2', { userId: 'u1', teamId: 't1', pattern: 'b', outcome: 'good' }));
    repo.bufferPromptLog(createPromptLog('l3', { userId: 'u1', teamId: 't1', pattern: 'c', outcome: 'bad' }));
    const stats = svc.myStats();
    expect(stats.totalLogged).toBe(3);
    expect(stats.goodRate).toBeCloseTo(0.67, 2);
  });

  it('returns a zero good rate when nothing is logged', () => {
    const stats = svc.myStats();
    expect(stats.totalLogged).toBe(0);
    expect(stats.goodRate).toBe(0);
  });
});

describe('PatternService.teamStats', () => {
  let db: Database.Database;
  let repo: SqliteTeamRepository;
  let svc: PatternService;

  beforeEach(() => {
    db = makeDb();
    repo = new SqliteTeamRepository(db);
    svc = new PatternService(repo);
  });

  it('aggregates contributions per member from the shared pool', () => {
    const base = { teamId: 't1', project: 'proj-a', content: 'x', memoryType: 'semantic', tags: Object.freeze([]), category: undefined, sharedAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' };
    repo.upsertSharedCache({ ...base, id: 'a', userId: 'u1' });
    repo.upsertSharedCache({ ...base, id: 'b', userId: 'u1' });
    repo.upsertSharedCache({ ...base, id: 'c', userId: 'u2' });
    const stats = svc.teamStats();
    expect(stats.totalSharedMemories).toBe(3);
    const u1 = stats.memberPatterns.find(m => m.userId === 'u1');
    expect(u1?.contribution).toBe(2);
  });

  it('derives top categories from prompt_category patterns', () => {
    repo.upsertPattern({ id: 'p1', userId: 'u1', teamId: 't1', project: undefined, patternType: 'prompt_category', metric: 'debugging', value: 5, period: 'monthly', computedAt: '2026-01-01T00:00:00Z' });
    repo.upsertPattern({ id: 'p2', userId: 'u1', teamId: 't1', project: undefined, patternType: 'prompt_category', metric: 'testing', value: 2, period: 'monthly', computedAt: '2026-01-01T00:00:00Z' });
    const stats = svc.teamStats();
    expect(stats.topCategories[0]).toEqual({ category: 'debugging', count: 5 });
  });
});
