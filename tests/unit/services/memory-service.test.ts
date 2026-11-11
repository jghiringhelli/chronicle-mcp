import { describe, it, expect } from 'vitest';
import { MemoryService } from '../../../src/services/memory-service.js';
import type { MemoryRepository, RecallQuery, MemorySearchResult } from '../../../src/ports/repositories/memory-repository.js';
import type { IdGenerator } from '../../../src/ports/gateways/id-generator.js';
import type { Clock } from '../../../src/ports/gateways/clock.js';
import { createMemory } from '../../../src/domain/entities/memory.js';
import { REINFORCEMENT_BOOSTS } from '../../../src/domain/types.js';
import type { Memory } from '../../../src/domain/entities/memory.js';
import type { Embedding, StorageTier } from '../../../src/domain/types.js';
import { tokenize } from '../../../src/shared/text.js';

// ── Fakes ──────────────────────────────────────────────────────────────────

class FakeMemoryRepo implements MemoryRepository {
  private store = new Map<string, Memory>();

  create(id: string, input: Parameters<MemoryRepository['create']>[1]): Memory {
    const m = createMemory(id, input);
    this.store.set(id, m);
    return m;
  }
  findById(id: string): Memory | undefined { return this.store.get(id); }
  /**
   * Mirrors the adapter's candidate stage, deliberately and not conveniently.
   *
   * It was a whole-string `content.includes(query)` match, which is not what the SQL does: the
   * adapter ORs one condition per content word and orders by weight. A fake that matches more
   * narrowly than the real query would let the service's ranking look correct against
   * candidates production never produces — `.claude/ledger.md`, "a test double that is more
   * convenient than reality tests the double".
   */
  recall(query: RecallQuery): MemorySearchResult[] {
    const words = tokenize(query.query);
    const hasText = query.query.trim().length > 0;
    if (hasText && words.length === 0) return [];
    return [...this.store.values()]
      .filter(m => !query.project || m.project === query.project)
      .filter(m => words.length === 0 || words.some(w =>
        m.content.toLowerCase().includes(w) || m.tags.some(t => t.toLowerCase().includes(w))))
      .sort((a, b) => b.weight - a.weight)
      .slice(0, query.limit ?? 10)
      .map(m => ({ memory: m, score: m.weight }));
  }
  update(m: Memory): void { this.store.set(m.id, m); }
  updateMany(ms: readonly Memory[]): void { for (const m of ms) this.store.set(m.id, m); }
  /**
   * Mirrors the adapter's set-based decay, using the same formula as EDR-001.
   * A fake that decayed differently would verify the service against behaviour nothing has.
   */
  promoteTier(fromTier: StorageTier, toTier: StorageTier, minAccess: number): number {
    let changed = 0;
    for (const m of [...this.store.values()]) {
      if (m.tier !== fromTier || m.accessCount < minAccess) continue;
      this.store.set(m.id, { ...m, tier: toTier });
      changed++;
    }
    return changed;
  }
  decayOlderThan(cutoff: string, now: string): number {
    let changed = 0;
    for (const m of [...this.store.values()]) {
      if (m.decayRate <= 0 || m.tier === 'core' || m.lastAccessedAt >= cutoff) continue;
      const days = (new Date(now).getTime() - new Date(m.lastAccessedAt).getTime()) / 86400000;
      this.store.set(m.id, { ...m, weight: m.weight * Math.exp(-m.decayRate * days) });
      changed++;
    }
    return changed;
  }
  delete(id: string, _reason: string): boolean { return this.store.delete(id); }
  findForDecay(olderThan: string): Memory[] {
    return [...this.store.values()].filter(
      m => m.tier !== 'core' && m.lastAccessedAt < olderThan
    );
  }
  findForPromotion(tier: StorageTier, minAccess: number): Memory[] {
    return [...this.store.values()].filter(m => m.tier === tier && m.accessCount >= minAccess);
  }
  count(criteria?: { tier?: StorageTier }): number {
    if (!criteria?.tier) return this.store.size;
    return [...this.store.values()].filter(m => m.tier === criteria.tier).length;
  }
  attachEmbedding(id: string, embedding: Embedding): void {
    const m = this.store.get(id);
    if (m) this.store.set(id, { ...m, embedding });
  }
}

const fakeIdGen: IdGenerator = {
  memoryId: () => 'mem_test',
  triggerId: () => 'trig_test',
  sessionId: () => 'sess_test',
};

const fakeClock: Clock = {
  now: () => '2026-01-01T00:00:00.000Z',
  nowDate: () => new Date('2026-01-01'),
  daysBetween: (from, to) => (new Date(to).getTime() - new Date(from).getTime()) / 86400000,
};

// ── Tests ──────────────────────────────────────────────────────────────────

describe('MemoryService.remember', () => {
  it('creates and stores a memory, returns it', () => {
    const repo = new FakeMemoryRepo();
    const svc = new MemoryService(repo, fakeIdGen, fakeClock);
    const m = svc.remember({ content: 'use pnpm not npm', memoryType: 'procedural' });
    expect(m.id).toBe('mem_test');
    expect(m.content).toBe('use pnpm not npm');
    expect(repo.findById('mem_test')).toBeDefined();
  });
});

describe('MemoryService.recall', () => {
  it('returns matching memories', () => {
    const repo = new FakeMemoryRepo();
    // Seed directly so IDs are unique
    repo.create('m1', { content: 'use tailwind for styling', memoryType: 'semantic' });
    repo.create('m2', { content: 'use postgres for the DB', memoryType: 'semantic' });
    const svc = new MemoryService(repo, fakeIdGen, fakeClock);
    const results = svc.recall({ query: 'tailwind' });
    expect(results).toHaveLength(1);
    expect(results[0]?.content).toContain('tailwind');
  });

  it('returns empty array when no match', () => {
    const repo = new FakeMemoryRepo();
    const svc = new MemoryService(repo, fakeIdGen, fakeClock);
    expect(svc.recall({ query: 'nonexistent' })).toEqual([]);
  });
});

/**
 * Ranking, which recall did not have.
 *
 * The adapter selects candidates and the service orders them. Before this, the order was the
 * adapter's `weight DESC` and the query was never consulted, so a memory matching one word of
 * three outranked one matching all three whenever it weighed more. Measured over a labelled
 * corpus that was MRR 0.26 (docs/evidence/recall-experiment.json, `keyword`).
 */
describe('MemoryService.recall ranks by relevance', () => {
  const seeded = (): FakeMemoryRepo => {
    const repo = new FakeMemoryRepo();
    // The heavy memory shares exactly one word with the query; the light one has all three.
    repo.update({
      ...repo.create('heavy', { content: 'terraform is the tool we use here', memoryType: 'semantic' }),
      weight: 0.99,
    });
    repo.update({
      ...repo.create('light', { content: 'terraform state locking uses a dynamodb table', memoryType: 'semantic' }),
      weight: 0.05,
    });
    return repo;
  };

  it('puts the fuller match first even when it weighs far less', () => {
    const svc = new MemoryService(seeded(), fakeIdGen, fakeClock);
    const out = svc.recall({ query: 'terraform state locking' });
    expect(out[0]?.id).toBe('light');
  });

  it('applies the limit after ranking, not before', () => {
    // The defect this pins: truncating in SQL by weight discards the best match before anything
    // has scored it, so a limit of 1 returned the wrong memory however good the ranker was.
    const svc = new MemoryService(seeded(), fakeIdGen, fakeClock);
    const out = svc.recall({ query: 'terraform state locking', limit: 1 });
    expect(out).toHaveLength(1);
    expect(out[0]?.id).toBe('light');
  });

  it('returns nothing for a query made only of stop words', () => {
    const svc = new MemoryService(seeded(), fakeIdGen, fakeClock);
    expect(svc.recall({ query: 'what is it that we should do about this' })).toEqual([]);
  });

  it('still returns everything in scope for an empty query', () => {
    // `session start` and `distill` both recall with an empty query, meaning "no text filter".
    // That must keep working: an empty query is not a query with no content words.
    const svc = new MemoryService(seeded(), fakeIdGen, fakeClock);
    expect(svc.recall({ query: '' })).toHaveLength(2);
  });

  it('drops a candidate that matched a word but scores nothing against the query', () => {
    const repo = new FakeMemoryRepo();
    repo.create('a', { content: 'the retry storm took the service down', memoryType: 'episodic' });
    repo.create('b', { content: 'the job queue retries with backoff', memoryType: 'architectural' });
    const svc = new MemoryService(repo, fakeIdGen, fakeClock);
    const out = svc.recall({ query: 'retry storm' });
    expect(out[0]?.id).toBe('a');
  });
});

describe('MemoryService.forget', () => {
  it('removes memory from store', () => {
    const repo = new FakeMemoryRepo();
    repo.create('m1', { content: 'test', memoryType: 'episodic' });
    const svc = new MemoryService(repo, fakeIdGen, fakeClock);
    svc.forget('m1', 'no longer relevant');
    expect(repo.findById('m1')).toBeUndefined();
  });
});

describe('MemoryService.reinforce', () => {
  it('boosts weight correctly', () => {
    const repo = new FakeMemoryRepo();
    repo.create('m1', { content: 'test', memoryType: 'episodic' });
    const svc = new MemoryService(repo, fakeIdGen, fakeClock);
    const original = repo.findById('m1')!;
    const boosted = svc.reinforce('m1', 'RECALL_HIT');
    const expected = original.weight + REINFORCEMENT_BOOSTS.RECALL_HIT * (1 - original.weight);
    expect(boosted.weight).toBeCloseTo(expected);
    expect(boosted.accessCount).toBe(1);
  });

  it('throws when memory not found', () => {
    const repo = new FakeMemoryRepo();
    const svc = new MemoryService(repo, fakeIdGen, fakeClock);
    expect(() => svc.reinforce('nonexistent', 'RECALL_HIT')).toThrow();
  });
});

describe('MemoryService.applyDecay', () => {
  it('decays old non-core memories', () => {
    const repo = new FakeMemoryRepo();
    // Fix: set lastAccessedAt 10 days before the fake clock's "now" (2026-01-01)
    const tenDaysAgo = new Date(new Date('2026-01-01').getTime() - 10 * 86400000).toISOString();
    const m = createMemory('m_old', { content: 'old episodic', memoryType: 'episodic' });
    repo.update({ ...m, lastAccessedAt: tenDaysAgo });

    const svc = new MemoryService(repo, fakeIdGen, fakeClock);
    // findForDecay cutoff: 7 days before fake now
    const count = svc.applyDecay();
    expect(count).toBe(1);
    const decayed = repo.findById('m_old')!;
    expect(decayed.weight).toBeLessThan(m.weight);
  });

  it('does not decay core memories', () => {
    const repo = new FakeMemoryRepo();
    repo.create('m_core', { content: 'core', memoryType: 'procedural' }); // tier=core
    const svc = new MemoryService(repo, fakeIdGen, fakeClock);
    const count = svc.applyDecay();
    expect(count).toBe(0);
  });
});

describe('MemoryService.evaluateTierPromotions', () => {
  it('promotes buffer memories with sufficient access count', () => {
    const repo = new FakeMemoryRepo();
    const m = createMemory('m_promo', { content: 'x', memoryType: 'episodic' });
    // Manually set accessCount to promotion threshold
    repo.update({ ...m, tier: 'buffer', accessCount: 5 });
    const svc = new MemoryService(repo, fakeIdGen, fakeClock);
    const count = svc.evaluateTierPromotions();
    expect(count).toBeGreaterThan(0);
    expect(repo.findById('m_promo')?.tier).toBe('working');
  });
});
