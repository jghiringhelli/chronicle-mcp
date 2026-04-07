import { describe, it, expect } from 'vitest';
import {
  createMemory,
  reinforceMemory,
  decayMemory,
  promoteMemory,
  attachEmbedding,
} from '../../../src/domain/entities/memory.js';
import { DECAY_RATES, DEFAULT_TIERS, REINFORCEMENT_BOOSTS } from '../../../src/domain/types.js';

describe('createMemory', () => {
  it('creates a memory with correct defaults', () => {
    const m = createMemory('mem_1', { content: 'test', memoryType: 'episodic' });
    expect(m.id).toBe('mem_1');
    expect(m.content).toBe('test');
    expect(m.memoryType).toBe('episodic');
    expect(m.tier).toBe(DEFAULT_TIERS.episodic);
    expect(m.decayRate).toBe(DECAY_RATES.episodic);
    expect(m.weight).toBe(0.5);
    expect(m.accessCount).toBe(0);
    expect(m.confirmed).toBe(false);
    expect(m.tags).toEqual([]);
    expect(m.embedding).toBeUndefined();
  });

  it('applies confirmed boost to initial weight', () => {
    const m = createMemory('mem_2', { content: 'x', memoryType: 'semantic', confirmed: true });
    const expected = Math.min(1.0, 0.5 + REINFORCEMENT_BOOSTS.CONFIRMED_REMEMBER);
    expect(m.weight).toBeCloseTo(expected);
    expect(m.confirmed).toBe(true);
  });

  it('confirmed:true overrides decay to 0 and promotes to core regardless of type', () => {
    const semantic = createMemory('mem_2a', { content: 'pnpm is our package manager', memoryType: 'semantic', confirmed: true });
    expect(semantic.decayRate).toBe(0);
    expect(semantic.tier).toBe('core');

    const episodic = createMemory('mem_2b', { content: 'deployed v1.0 on 2026-04-07', memoryType: 'episodic', confirmed: true });
    expect(episodic.decayRate).toBe(0);
    expect(episodic.tier).toBe('core');
  });

  it('insight memories default to core tier and zero decay', () => {
    const m = createMemory('mem_2c', { content: 'always forgets to run migrations before deploy', memoryType: 'insight' });
    expect(m.tier).toBe('core');
    expect(m.decayRate).toBe(0);
  });

  it('procedural memories default to core tier and zero decay', () => {
    const m = createMemory('mem_3', { content: 'how-to', memoryType: 'procedural' });
    expect(m.tier).toBe('core');
    expect(m.decayRate).toBe(0);
  });

  it('architectural memories default to core tier and zero decay', () => {
    const m = createMemory('mem_4', { content: 'adr', memoryType: 'architectural' });
    expect(m.tier).toBe('core');
    expect(m.decayRate).toBe(0);
  });

  it('freezes the tags array', () => {
    const m = createMemory('mem_5', { content: 'x', memoryType: 'episodic', tags: ['a', 'b'] });
    expect(Object.isFrozen(m.tags)).toBe(true);
    expect(m.tags).toEqual(['a', 'b']);
  });
});

describe('reinforceMemory', () => {
  it('increases weight with asymptotic ceiling formula', () => {
    const m = createMemory('mem_6', { content: 'x', memoryType: 'episodic' });
    const boost = REINFORCEMENT_BOOSTS.RECALL_HIT;
    const reinforced = reinforceMemory(m, boost);
    const expected = m.weight + boost * (1 - m.weight);
    expect(reinforced.weight).toBeCloseTo(expected);
    expect(reinforced.accessCount).toBe(1);
  });

  it('never exceeds 1.0', () => {
    let m = createMemory('mem_7', { content: 'x', memoryType: 'episodic' });
    // Boost many times
    for (let i = 0; i < 100; i++) {
      m = reinforceMemory(m, 0.5);
    }
    expect(m.weight).toBeLessThanOrEqual(1.0);
  });

  it('returns a new object (immutable)', () => {
    const m = createMemory('mem_8', { content: 'x', memoryType: 'episodic' });
    const reinforced = reinforceMemory(m, 0.1);
    expect(reinforced).not.toBe(m);
  });
});

describe('decayMemory', () => {
  it('applies exponential decay formula', () => {
    const m = createMemory('mem_9', { content: 'x', memoryType: 'episodic' }); // decayRate 0.1
    const decayed = decayMemory(m, 7);
    const expected = m.weight * Math.exp(-0.1 * 7);
    expect(decayed.weight).toBeCloseTo(expected);
  });

  it('does not decay memories with decayRate 0', () => {
    const m = createMemory('mem_10', { content: 'x', memoryType: 'procedural' });
    const decayed = decayMemory(m, 30);
    expect(decayed.weight).toBe(m.weight);
    expect(decayed).toBe(m); // same reference returned
  });
});

describe('promoteMemory', () => {
  it('changes tier and returns new object', () => {
    const m = createMemory('mem_11', { content: 'x', memoryType: 'episodic' });
    expect(m.tier).toBe('buffer');
    const promoted = promoteMemory(m, 'working');
    expect(promoted.tier).toBe('working');
    expect(promoted).not.toBe(m);
  });
});

describe('attachEmbedding', () => {
  it('attaches embedding vector', () => {
    const m = createMemory('mem_12', { content: 'x', memoryType: 'episodic' });
    const vec = [0.1, 0.2, 0.3];
    const withEmbed = attachEmbedding(m, vec);
    expect(withEmbed.embedding).toEqual(vec);
    expect(withEmbed).not.toBe(m);
  });
});
