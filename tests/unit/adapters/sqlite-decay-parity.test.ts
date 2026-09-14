import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { SqliteMemoryRepository } from '../../../src/adapters/repositories/sqlite-memory-repository.js';
import { SCHEMA_SQL } from '../../../src/infrastructure/db/schema.js';
import { decayMemory, createMemory } from '../../../src/domain/entities/memory.js';
import type { Memory } from '../../../src/domain/entities/memory.js';
import type { MemoryType } from '../../../src/domain/types.js';

/**
 * Parity between the two implementations of EDR-001's decay formula.
 *
 * There are now two: `decayMemory()` in the domain, which is the readable statement of the rule and
 * the single-memory path, and `decayOlderThan()` in the adapter, which runs it as SQL because a
 * row-by-row pass cost 10.4s at 50,000 memories against a 500ms budget (NFR-04).
 *
 * Two copies of a formula is exactly the kind of duplication that drifts, and a drift here is
 * invisible: weights would simply be slightly wrong forever. So this file pins them to the same
 * answer, and it is the justification for allowing the duplication at all.
 */
describe('decay parity: SQL and domain agree', () => {
  let db: Database.Database;
  let repo: SqliteMemoryRepository;

  const NOW = '2026-09-12T00:00:00.000Z';
  const daysAgo = (n: number) => new Date(Date.parse(NOW) - n * 86_400_000).toISOString();

  /** Insert a memory with a chosen age, bypassing the service so the setup is explicit. */
  const seed = (
    id: string,
    type: MemoryType,
    opts: { days: number; weight?: number; tier?: 'buffer' | 'working' | 'core' } ,
  ): Memory => {
    const base = createMemory(id, { content: `content ${id}`, memoryType: type });
    const m: Memory = {
      ...base,
      weight: opts.weight ?? 0.8,
      tier: opts.tier ?? base.tier,
      lastAccessedAt: daysAgo(opts.days),
      createdAt: daysAgo(opts.days + 10),
    };
    db.prepare(`
      INSERT INTO memories (id, content, memory_type, tier, weight, decay_rate, access_count,
        created_at, last_accessed_at, project, scope, category, tags, confirmed)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, NULL, '[]', 0)`).run(
      m.id, m.content, m.memoryType, m.tier, m.weight, m.decayRate, m.accessCount,
      m.createdAt, m.lastAccessedAt, m.scope,
    );
    return m;
  };

  const weightOf = (id: string) =>
    (db.prepare('SELECT weight FROM memories WHERE id = ?').get(id) as { weight: number }).weight;

  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(SCHEMA_SQL);
    repo = new SqliteMemoryRepository(db);
  });

  afterEach(() => db.close());

  it('produces the same weight as decayMemory for an episodic memory', () => {
    const seeded = seed('m-epi', 'episodic', { days: 14, weight: 0.8 });

    repo.decayOlderThan(daysAgo(7), NOW);

    const expected = decayMemory(seeded, 14).weight;
    expect(weightOf('m-epi')).toBeCloseTo(expected, 9);
  });

  it('agrees for a semantic memory, whose rate is five times smaller', () => {
    const seeded = seed('m-sem', 'semantic', { days: 30, weight: 0.9, tier: 'working' });

    repo.decayOlderThan(daysAgo(7), NOW);

    expect(weightOf('m-sem')).toBeCloseTo(decayMemory(seeded, 30).weight, 9);
  });

  it('agrees across a range of ages', () => {
    // A single age could match by luck; a curve cannot.
    const ages = [8, 15, 30, 60, 120, 365];
    const seeded = ages.map((d, i) => seed(`m-age-${i}`, 'episodic', { days: d, weight: 0.95 }));

    repo.decayOlderThan(daysAgo(7), NOW);

    seeded.forEach((m, i) => {
      expect(weightOf(`m-age-${i}`), `age ${ages[i]}d`).toBeCloseTo(decayMemory(m, ages[i]!).weight, 9);
    });
  });

  it('agrees across a range of starting weights', () => {
    const weights = [0.05, 0.25, 0.5, 0.75, 1.0];
    const seeded = weights.map((w, i) => seed(`m-w-${i}`, 'episodic', { days: 20, weight: w }));

    repo.decayOlderThan(daysAgo(7), NOW);

    seeded.forEach((m, i) => {
      expect(weightOf(`m-w-${i}`), `weight ${weights[i]}`).toBeCloseTo(decayMemory(m, 20).weight, 9);
    });
  });

  describe('permanence, which both implementations must preserve', () => {
    it('leaves a procedural memory untouched', () => {
      seed('m-proc', 'procedural', { days: 400, weight: 0.8, tier: 'working' });

      repo.decayOlderThan(daysAgo(7), NOW);

      // decayRate is 0, so `decayMemory` early-returns and the SQL excludes it. Both must agree that
      // nothing happens — this is what makes permanent memories permanent by construction.
      expect(weightOf('m-proc')).toBe(0.8);
    });

    it('leaves an architectural memory untouched', () => {
      seed('m-arch', 'architectural', { days: 400, weight: 0.6, tier: 'working' });

      repo.decayOlderThan(daysAgo(7), NOW);

      expect(weightOf('m-arch')).toBe(0.6);
    });

    it('leaves an insight untouched', () => {
      seed('m-ins', 'insight', { days: 400, weight: 0.7, tier: 'working' });

      repo.decayOlderThan(daysAgo(7), NOW);

      expect(weightOf('m-ins')).toBe(0.7);
    });

    it('never touches a core-tier memory, whatever its rate', () => {
      // Belt and braces: the tier guard is independent of the rate guard.
      seed('m-core', 'episodic', { days: 400, weight: 0.9, tier: 'core' });

      repo.decayOlderThan(daysAgo(7), NOW);

      expect(weightOf('m-core')).toBe(0.9);
    });
  });

  describe('the cutoff', () => {
    it('skips a memory accessed more recently than the cutoff', () => {
      seed('m-fresh', 'episodic', { days: 2, weight: 0.8 });

      const changed = repo.decayOlderThan(daysAgo(7), NOW);

      expect(changed).toBe(0);
      expect(weightOf('m-fresh')).toBe(0.8);
    });

    it('reports how many rows it changed', () => {
      seed('m-1', 'episodic', { days: 10 });
      seed('m-2', 'episodic', { days: 20 });
      seed('m-fresh', 'episodic', { days: 1 });
      seed('m-perm', 'procedural', { days: 100, tier: 'working' });

      expect(repo.decayOlderThan(daysAgo(7), NOW)).toBe(2);
    });

    it('is a no-op on an empty store', () => {
      expect(repo.decayOlderThan(daysAgo(7), NOW)).toBe(0);
    });
  });

  it('is monotonic: decay never raises a weight', () => {
    const ids = ['a', 'b', 'c'];
    const before = ids.map((id, i) => {
      seed(`m-${id}`, 'episodic', { days: 10 * (i + 1), weight: 0.9 });
      return weightOf(`m-${id}`);
    });

    repo.decayOlderThan(daysAgo(7), NOW);

    ids.forEach((id, i) => expect(weightOf(`m-${id}`)).toBeLessThan(before[i]!));
  });
});
