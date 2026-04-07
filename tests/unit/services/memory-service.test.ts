import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MemoryService } from '../../../src/services/memory-service.js';
import type { MemoryRepository, RecallQuery, MemorySearchResult } from '../../../src/ports/repositories/memory-repository.js';
import type { IdGenerator } from '../../../src/ports/gateways/id-generator.js';
import type { Clock } from '../../../src/ports/gateways/clock.js';
import { createMemory } from '../../../src/domain/entities/memory.js';
import { REINFORCEMENT_BOOSTS } from '../../../src/domain/types.js';
import type { Memory } from '../../../src/domain/entities/memory.js';
import type { Embedding, StorageTier } from '../../../src/domain/types.js';

// ── Fakes ──────────────────────────────────────────────────────────────────

class FakeMemoryRepo implements MemoryRepository {
  private store = new Map<string, Memory>();

  create(id: string, input: Parameters<MemoryRepository['create']>[1]): Memory {
    const m = createMemory(id, input);
    this.store.set(id, m);
    return m;
  }
  findById(id: string): Memory | undefined { return this.store.get(id); }
  recall(query: RecallQuery): MemorySearchResult[] {
    return [...this.store.values()]
      .filter(m => !query.project || m.project === query.project)
      .filter(m => m.content.includes(query.query))
      .slice(0, query.limit ?? 10)
      .map(m => ({ memory: m, score: m.weight }));
  }
  update(m: Memory): void { this.store.set(m.id, m); }
  delete(id: string, _reason: string): void { this.store.delete(id); }
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
