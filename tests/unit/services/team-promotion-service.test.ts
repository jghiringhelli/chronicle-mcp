/**
 * Unit tests for TeamPromotionService — candidate selection, lexical dedup,
 * and the promote orchestration.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import {
  TeamPromotionService,
  tokenize,
  contentSimilarity,
  PROMOTE_SIMILARITY_THRESHOLD,
} from '../../../src/services/team-promotion-service.js';
import { SqliteTeamRepository } from '../../../src/adapters/repositories/sqlite-team-repository.js';
import { SCHEMA_SQL } from '../../../src/infrastructure/db/schema.js';
import type { TeamSyncService, SharedMemoryInput } from '../../../src/services/team-sync-service.js';
import type { EmbeddingGateway } from '../../../src/ports/gateways/embedding-gateway.js';

/**
 * Deterministic fake embedding gateway: each text becomes a bag-of-keywords
 * count vector over a fixed vocabulary, so near-duplicates score high cosine.
 */
const VOCAB = ['validate', 'input', 'server', 'dependency', 'injection', 'composition', 'testing', 'auth'];
class FakeEmbeddings implements EmbeddingGateway {
  async available(): Promise<boolean> { return true; }
  async generate(text: string): Promise<number[]> { return this.vec(text); }
  async generateBatch(texts: string[]): Promise<number[][]> { return texts.map(t => this.vec(t)); }
  cosineSimilarity(a: number[], b: number[]): number {
    let dot = 0, na = 0, nb = 0;
    for (let i = 0; i < a.length; i++) { dot += a[i]! * b[i]!; na += a[i]! ** 2; nb += b[i]! ** 2; }
    return na === 0 || nb === 0 ? 0 : dot / (Math.sqrt(na) * Math.sqrt(nb));
  }
  private vec(text: string): number[] {
    const lower = text.toLowerCase();
    return VOCAB.map(w => (lower.split(w).length - 1));
  }
}

const { cfg } = vi.hoisted(() => ({
  cfg: { userId: 'u1', teamId: 't1', railwayUrl: 'postgres://stub' as string | undefined, deviceId: 'd1', dbPath: ':memory:' },
}));
vi.mock('../../../src/shared/config/index.js', () => ({ getConfig: () => cfg }));

function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.exec(SCHEMA_SQL);
  return db;
}

function insertMemory(db: Database.Database, id: string, content: string, opts: { confirmed?: boolean; tier?: string; project?: string } = {}): void {
  db.prepare(`
    INSERT INTO memories (id, content, memory_type, tier, weight, decay_rate, access_count, created_at, last_accessed_at, project, tags, confirmed)
    VALUES (?, ?, 'semantic', ?, 0.8, 0.1, 0, ?, ?, ?, '[]', ?)
  `).run(id, content, opts.tier ?? 'working', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', opts.project ?? 'proj-a', opts.confirmed ? 1 : 0);
}

describe('tokenize', () => {
  it('lowercases and drops tokens shorter than three characters', () => {
    expect(tokenize('Use TS to a fix')).toEqual(new Set(['use', 'fix']));
  });

  it('returns an empty set for punctuation-only input', () => {
    expect(tokenize('!! -- ??').size).toBe(0);
  });
});

describe('contentSimilarity', () => {
  it('scores identical content as 1', () => {
    expect(contentSimilarity('alpha beta gamma', 'alpha beta gamma')).toBe(1);
  });

  it('scores fully disjoint content as 0', () => {
    expect(contentSimilarity('alpha beta', 'gamma delta')).toBe(0);
  });

  it('returns 0 when either side has no usable tokens', () => {
    expect(contentSimilarity('', 'alpha beta')).toBe(0);
    expect(contentSimilarity('a b c', 'alpha')).toBe(0); // left has no >=3 char tokens
  });

  it('computes partial overlap as Jaccard', () => {
    // tokens {alpha,beta,gamma} vs {beta,gamma,delta} -> intersection 2, union 4
    expect(contentSimilarity('alpha beta gamma', 'beta gamma delta')).toBeCloseTo(0.5);
  });
});

describe('TeamPromotionService.promote', () => {
  let db: Database.Database;
  let repo: SqliteTeamRepository;
  let pushed: SharedMemoryInput[];
  let svc: TeamPromotionService;

  beforeEach(() => {
    cfg.railwayUrl = 'postgres://stub';
    db = makeDb();
    repo = new SqliteTeamRepository(db);
    pushed = [];
    const fakeSync = {
      pushSharedMemory: async (m: SharedMemoryInput) => { pushed.push(m); return m.id; },
    } as unknown as TeamSyncService;
    svc = new TeamPromotionService(db, repo, fakeSync);
  });

  it('promotes a novel high-value memory to the team pool', async () => {
    insertMemory(db, 'm1', 'prefer dependency injection at the composition root', { confirmed: true });
    const result = await svc.promote('proj-a');
    expect(result.promoted.map(p => p.id)).toEqual(['m1']);
    expect(pushed).toHaveLength(1);
  });

  it('ignores buffer-tier, unconfirmed memories as candidates', async () => {
    insertMemory(db, 'm1', 'ephemeral scratch note', { tier: 'buffer', confirmed: false });
    const result = await svc.promote('proj-a');
    expect(result.scanned).toBe(0);
    expect(pushed).toHaveLength(0);
  });

  it('skips a memory already present in the team pool by id', async () => {
    insertMemory(db, 'm1', 'shared already', { confirmed: true });
    repo.upsertSharedCache({
      id: 'm1', userId: 'u1', teamId: 't1', project: 'proj-a',
      content: 'shared already', memoryType: 'semantic', tags: Object.freeze([]),
      category: undefined, sharedAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
    });
    const result = await svc.promote('proj-a');
    expect(result.promoted).toHaveLength(0);
    expect(result.skipped[0]).toMatchObject({ id: 'm1', reason: 'already-shared' });
  });

  it('skips a near-duplicate of existing team knowledge', async () => {
    insertMemory(db, 'm2', 'always validate user input on the server side', { confirmed: true });
    repo.upsertSharedCache({
      id: 'other', userId: 'u2', teamId: 't1', project: 'proj-a',
      content: 'always validate user input on the server side too', memoryType: 'semantic',
      tags: Object.freeze([]), category: undefined,
      sharedAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
    });
    const result = await svc.promote('proj-a');
    expect(pushed).toHaveLength(0);
    expect(result.skipped[0]).toMatchObject({ id: 'm2', reason: 'duplicate', similarTo: 'other' });
  });

  it('reports railwaySkipped and pushes nothing when railwayUrl is absent', async () => {
    cfg.railwayUrl = undefined;
    insertMemory(db, 'm1', 'something worth sharing', { confirmed: true });
    const result = await svc.promote('proj-a');
    expect(result.railwaySkipped).toBe(true);
    expect(pushed).toHaveLength(0);
  });

  it('exposes a threshold in the documented [0,1] range', () => {
    expect(PROMOTE_SIMILARITY_THRESHOLD).toBeGreaterThan(0);
    expect(PROMOTE_SIMILARITY_THRESHOLD).toBeLessThanOrEqual(1);
  });
});

describe('TeamPromotionService.promote (semantic mode)', () => {
  let db: Database.Database;
  let repo: SqliteTeamRepository;
  let pushed: SharedMemoryInput[];
  let svc: TeamPromotionService;

  beforeEach(() => {
    cfg.railwayUrl = 'postgres://stub';
    db = makeDb();
    repo = new SqliteTeamRepository(db);
    pushed = [];
    const fakeSync = {
      pushSharedMemory: async (m: SharedMemoryInput) => { pushed.push(m); return m.id; },
    } as unknown as TeamSyncService;
    svc = new TeamPromotionService(db, repo, fakeSync, new FakeEmbeddings());
  });

  it('reports semantic method when an embedding gateway is available', async () => {
    insertMemory(db, 'm1', 'prefer dependency injection at the composition root', { confirmed: true });
    const result = await svc.promote('proj-a');
    expect(result.method).toBe('semantic');
  });

  it('skips a semantic near-duplicate even when wording differs', async () => {
    insertMemory(db, 'm1', 'validate the input on the server', { confirmed: true });
    repo.upsertSharedCache({
      id: 'pooled', userId: 'u2', teamId: 't1', project: 'proj-a',
      content: 'server must validate input', memoryType: 'semantic',
      tags: Object.freeze([]), category: undefined,
      sharedAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
    });
    const result = await svc.promote('proj-a');
    expect(pushed).toHaveLength(0);
    expect(result.skipped[0]).toMatchObject({ id: 'm1', reason: 'duplicate', similarTo: 'pooled' });
  });

  it('promotes a semantically distinct memory', async () => {
    insertMemory(db, 'm1', 'dependency injection composition root', { confirmed: true });
    repo.upsertSharedCache({
      id: 'pooled', userId: 'u2', teamId: 't1', project: 'proj-a',
      content: 'validate input server', memoryType: 'semantic',
      tags: Object.freeze([]), category: undefined,
      sharedAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
    });
    const result = await svc.promote('proj-a');
    expect(result.promoted.map(p => p.id)).toEqual(['m1']);
  });
});
