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

  /**
   * ADR-019 §1: the raw prompt text is a LOCAL staging area, and the cloud `prompt_logs` is the
   * sharing boundary. `migrate-cloud-db.mjs` dropped both columns there, so a statement that names
   * them is two defects in one line: it breaks the push against the real database, and on a fresh
   * one it would carry prompt text into a database a partner reads.
   *
   * This asserts the statement we EMIT, not what a fake returns — the fake is only a recorder.
   */
  it('never names raw_content or share_content in the statement it sends to the cloud', async () => {
    const statements: string[] = [];
    vi.doMock('postgres', () => ({
      default: () => {
        const sql = (strings: TemplateStringsArray) => {
          statements.push(strings.join('?'));
          return Promise.resolve([]);
        };
        (sql as unknown as { end: () => Promise<void> }).end = () => Promise.resolve();
        return sql;
      },
    }));
    cfg.railwayUrl = 'postgres://stand-in/db';

    svc.log({ pattern: 'stage it', shareContent: true, rawContent: 'the raw prompt' });
    await svc.pushBuffer();

    expect(statements.length).toBeGreaterThan(0);
    const insert = statements.join('\n');
    expect(insert).toMatch(/INSERT INTO prompt_logs/);
    expect(insert).not.toMatch(/raw_content/);
    expect(insert).not.toMatch(/share_content/);
  });

  it('keeps the raw text in the local buffer, which is where analysis will read it', () => {
    svc.log({ pattern: 'stage it', shareContent: true, rawContent: 'the raw prompt' });
    const [staged] = repo.getPendingPromptLogs();
    expect(staged?.rawContent).toBe('the raw prompt');
  });

  // ── EDR-005: the three stages — staged, analysed, evicted ────────────────────────────────

  describe('the lifecycle', () => {
    it('a fresh row is staged and unanalysed', () => {
      svc.log({ pattern: 'a', shareContent: true, rawContent: 'text a' });
      expect(repo.getUnanalysedPromptLogs()).toHaveLength(1);
    });

    it('marking analysed takes the row out of the unanalysed set, idempotently', () => {
      const a = svc.log({ pattern: 'a' });
      repo.markPromptLogsAnalysed([a.id]);
      expect(repo.getUnanalysedPromptLogs()).toHaveLength(0);
      // Twice must not corrupt anything: an agent may call the apply phase again.
      repo.markPromptLogsAnalysed([a.id]);
      expect(repo.getUnanalysedPromptLogs()).toHaveLength(0);
    });

    it('status and analysed_at are independent — pushed does not mean analysed', () => {
      const a = svc.log({ pattern: 'a' });
      repo.markPromptLogsPushed([a.id]);
      expect(repo.getPendingPromptLogs()).toHaveLength(0);   // pushed
      expect(repo.getUnanalysedPromptLogs()).toHaveLength(1); // and still unanalysed
    });

    it('retention 0 evicts on analysis', () => {
      const a = svc.log({ pattern: 'a' });
      repo.markPromptLogsAnalysed([a.id]);
      // No remote configured, so an unpushed pattern has nowhere to go and the row is evictable.
      expect(svc.evictAnalysed(0)).toBe(1);
      expect(repo.getUnanalysedPromptLogs()).toHaveLength(0);
      expect(repo.getPendingPromptLogs()).toHaveLength(0);
    });

    it('retention keeps an analysed row until the window elapses', () => {
      const a = svc.log({ pattern: 'a' });
      repo.markPromptLogsAnalysed([a.id]);
      expect(svc.evictAnalysed(7)).toBe(0);          // analysed just now — inside the window
      expect(svc.evictAnalysed(-1)).toBe(1);         // a cutoff in the future releases it
    });

    it('never evicts an unanalysed row, whatever the retention', () => {
      svc.log({ pattern: 'a' });
      expect(svc.evictAnalysed(0)).toBe(0);
      expect(repo.getUnanalysedPromptLogs()).toHaveLength(1);
    });

    it('keeps an analysed-but-unpushed row while a remote is configured', () => {
      const a = svc.log({ pattern: 'a' });
      repo.markPromptLogsAnalysed([a.id]);
      cfg.railwayUrl = 'postgres://stand-in/db';
      // The pattern has not reached the team yet; evicting would lose it, not just the text.
      expect(svc.evictAnalysed(0)).toBe(0);
      repo.markPromptLogsPushed([a.id]);
      expect(svc.evictAnalysed(0)).toBe(1);
    });
  });
});
