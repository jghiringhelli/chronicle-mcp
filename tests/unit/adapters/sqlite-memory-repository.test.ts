import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { SqliteMemoryRepository } from '../../../src/adapters/repositories/sqlite-memory-repository.js';
import { SCHEMA_SQL } from '../../../src/infrastructure/db/schema.js';

// Use in-memory SQLite for integration tests — no file I/O
function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.exec(SCHEMA_SQL);
  return db;
}

describe('SqliteMemoryRepository', () => {
  let db: Database.Database;
  let repo: SqliteMemoryRepository;

  beforeEach(() => {
    db = makeDb();
    repo = new SqliteMemoryRepository(db);
  });

  it('creates and retrieves a memory by id', () => {
    const m = repo.create('mem_1', { content: 'use pnpm', memoryType: 'procedural' });
    expect(m.id).toBe('mem_1');
    const found = repo.findById('mem_1');
    expect(found).toBeDefined();
    expect(found?.content).toBe('use pnpm');
    expect(found?.tier).toBe('core'); // procedural default
  });

  it('returns undefined for missing id', () => {
    expect(repo.findById('nonexistent')).toBeUndefined();
  });

  it('updates weight and access count', () => {
    repo.create('mem_2', { content: 'test', memoryType: 'episodic' });
    const m = repo.findById('mem_2')!;
    repo.update({ ...m, weight: 0.9, accessCount: 5 });
    const updated = repo.findById('mem_2')!;
    expect(updated.weight).toBeCloseTo(0.9);
    expect(updated.accessCount).toBe(5);
  });

  it('deletes a memory', () => {
    repo.create('mem_3', { content: 'gone', memoryType: 'episodic' });
    repo.delete('mem_3', 'test cleanup');
    expect(repo.findById('mem_3')).toBeUndefined();
  });

  it('recalls by keyword match', () => {
    repo.create('mem_4', { content: 'tailwind styling system', memoryType: 'semantic' });
    repo.create('mem_5', { content: 'postgres database choice', memoryType: 'semantic' });
    const results = repo.recall({ query: 'tailwind', limit: 5 });
    expect(results).toHaveLength(1);
    expect(results[0]?.memory.content).toContain('tailwind');
  });

  /**
   * Candidate selection, which is all `recall` does here — the ordering is the service's job
   * (MemoryService.recall). These tests cover the one thing the adapter decides: which rows are
   * even eligible.
   */
  describe('candidate selection', () => {
    beforeEach(() => {
      repo.create('cand_1', { content: 'terraform state locking uses a dynamodb table', memoryType: 'architectural' });
      repo.create('cand_2', { content: 'the job queue retries with exponential backoff', memoryType: 'architectural' });
      repo.create('cand_3', { content: 'the modal keeps focus inside itself', memoryType: 'procedural', tags: ['accessibility'] });
    });

    it('returns nothing for a query whose words are all stop words', () => {
      // The shipped behaviour ORed one LIKE per word with no stop word handling, so "what is
      // the capital of France" matched nearly every row through `is` and `of`. Two of three
      // out-of-scope queries in the labelled corpus came back with a full page of results.
      expect(repo.recall({ query: 'what is it that we should do about this', limit: 10 })).toEqual([]);
    });

    it('ignores the stop words around a content word', () => {
      const results = repo.recall({ query: 'what do we do about the terraform state', limit: 10 });
      expect(results.map(r => r.memory.id)).toContain('cand_1');
    });

    it('matches a tag as well as the content', () => {
      const results = repo.recall({ query: 'accessibility', limit: 10 });
      expect(results.map(r => r.memory.id)).toContain('cand_3');
    });

    it('treats an empty query as no text filter, not as an unanswerable one', () => {
      // `session start` and `distill` recall with an empty query to mean "everything in scope".
      // An empty query and a query with no content words must not collapse into one case.
      const results = repo.recall({ query: '', limit: 10 });
      expect(results.length).toBeGreaterThanOrEqual(3);
    });

    it('does not match a word that appears nowhere', () => {
      expect(repo.recall({ query: 'bluetooth pairing', limit: 10 })).toEqual([]);
    });
  });

  it('finds memories for decay (non-core, old)', () => {
    const old = new Date(Date.now() - 10 * 86400000).toISOString();
    const m = repo.create('mem_6', { content: 'old episodic', memoryType: 'episodic' });
    repo.update({ ...m, lastAccessedAt: old });
    const toDecay = repo.findForDecay(new Date(Date.now() - 7 * 86400000).toISOString());
    expect(toDecay.some(x => x.id === 'mem_6')).toBe(true);
  });

  it('does not include core memories in decay candidates', () => {
    repo.create('mem_7', { content: 'procedural core', memoryType: 'procedural' });
    const toDecay = repo.findForDecay(new Date().toISOString());
    expect(toDecay.some(x => x.id === 'mem_7')).toBe(false);
  });

  it('finds memories for tier promotion', () => {
    const m = repo.create('mem_8', { content: 'accessed often', memoryType: 'episodic' });
    repo.update({ ...m, tier: 'buffer', accessCount: 5 });
    const candidates = repo.findForPromotion('buffer', 3);
    expect(candidates.some(x => x.id === 'mem_8')).toBe(true);
  });

  it('counts memories by tier', () => {
    repo.create('mem_9',  { content: 'a', memoryType: 'episodic' });
    repo.create('mem_10', { content: 'b', memoryType: 'procedural' }); // core
    expect(repo.count({ tier: 'buffer' })).toBe(1);
    expect(repo.count({ tier: 'core'   })).toBe(1);
    expect(repo.count()).toBe(2);
  });

  it('stores and serialises tags correctly', () => {
    repo.create('mem_11', { content: 'tagged', memoryType: 'semantic', tags: ['ts', 'node'] });
    const m = repo.findById('mem_11')!;
    expect(m.tags).toEqual(['ts', 'node']);
  });

  it('round-trips project and category', () => {
    repo.create('mem_12', {
      content: 'project mem', memoryType: 'semantic',
      project: 'chronicle', category: 'decision',
    });
    const m = repo.findById('mem_12')!;
    expect(m.project).toBe('chronicle');
    expect(m.category).toBe('decision');
  });
});
