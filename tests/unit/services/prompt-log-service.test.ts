/**
 * Unit tests for PromptLogService — local buffering and push guards.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { PromptLogService } from '../../../src/services/prompt-log-service.js';
import { SqliteTeamRepository } from '../../../src/adapters/repositories/sqlite-team-repository.js';
import { SCHEMA_SQL } from '../../../src/infrastructure/db/schema.js';
import type { IdGenerator } from '../../../src/ports/gateways/id-generator.js';

const { cfg } = vi.hoisted(() => ({
  cfg: { userId: 'u1', teamId: 't1' as string | undefined, railwayUrl: undefined as string | undefined, deviceId: 'd1', dbPath: ':memory:' },
}));
vi.mock('../../../src/shared/config/index.js', () => ({ getConfig: () => cfg }));

function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.exec(SCHEMA_SQL);
  return db;
}

describe('PromptLogService', () => {
  let db: Database.Database;
  let repo: SqliteTeamRepository;
  let svc: PromptLogService;

  beforeEach(() => {
    cfg.teamId = 't1';
    cfg.railwayUrl = undefined;
    db = makeDb();
    repo = new SqliteTeamRepository(db);
    let n = 0;
    const idGen = { memoryId: () => `log_${n++}` } as unknown as IdGenerator;
    svc = new PromptLogService(repo, idGen);
  });

  it('buffers a logged prompt as pending', () => {
    const log = svc.log({ pattern: 'refactor a service', outcome: 'good', category: 'refactoring' });
    expect(log.status).toBe('pending');
    expect(repo.getPendingPromptLogs()).toHaveLength(1);
  });

  it('does not persist raw content unless the user opts in', () => {
    const log = svc.log({ pattern: 'do a thing', rawContent: 'secret prompt' });
    expect(log.rawContent).toBeUndefined();
    const optedIn = svc.log({ pattern: 'do a thing', shareContent: true, rawContent: 'shared prompt' });
    expect(optedIn.rawContent).toBe('shared prompt');
  });

  it('throws when teamId is not configured', () => {
    cfg.teamId = undefined;
    expect(() => svc.log({ pattern: 'x' })).toThrow('teamId not configured');
  });

  it('pushBuffer is a no-op (returns 0) without railwayUrl', async () => {
    svc.log({ pattern: 'x' });
    await expect(svc.pushBuffer()).resolves.toBe(0);
    // Buffer remains pending because nothing was pushed.
    expect(repo.getPendingPromptLogs()).toHaveLength(1);
  });
});
