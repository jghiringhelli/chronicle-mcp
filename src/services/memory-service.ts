/**
 * MemoryService — application-layer orchestration for memory operations.
 */

import type { MemoryRepository } from '../ports/repositories/memory-repository.js';
import type { RecallQuery } from '../ports/repositories/memory-repository.js';
import type { IdGenerator } from '../ports/gateways/id-generator.js';
import type { Clock } from '../ports/gateways/clock.js';
import type { Memory, CreateMemoryInput } from '../domain/entities/memory.js';
import { reinforceMemory } from '../domain/entities/memory.js';
import { REINFORCEMENT_BOOSTS } from '../domain/types.js';

export class MemoryService {
  constructor(
    private repo: MemoryRepository,
    private idGen: IdGenerator,
    private clock: Clock,
  ) {}

  /**
   * Store a new memory.
   *
   * @param input - Memory creation parameters
   * @returns Created memory
   */
  remember(input: CreateMemoryInput): Memory {
    const id = this.idGen.memoryId();
    return this.repo.create(id, input);
  }

  /**
   * Search memories.
   *
   * @param query - Search parameters
   * @returns Matching memories sorted by relevance
   */
  recall(query: RecallQuery): Memory[] {
    const results = this.repo.recall(query);
    return results.map(r => r.memory);
  }

  /**
   * Delete a memory.
   *
   * @param id - Memory identifier
   * @param reason - Optional reason for deletion
   */
  forget(id: string, reason?: string): boolean {
    return this.repo.delete(id, reason ?? 'forgotten');
  }

  /**
   * Apply reinforcement boost to a memory.
   *
   * @param id - Memory identifier
   * @param boostType - Key from REINFORCEMENT_BOOSTS
   * @returns Reinforced memory
   */
  reinforce(id: string, boostType: keyof typeof REINFORCEMENT_BOOSTS): Memory {
    const memory = this.repo.findById(id);
    if (!memory) throw new Error(`Memory not found: ${id}`);
    const boosted = reinforceMemory(memory, REINFORCEMENT_BOOSTS[boostType]);
    this.repo.update(boosted);
    return boosted;
  }

  /**
   * Run a decay pass on all non-core memories not accessed within 7 days.
   *
   * @returns Number of memories processed
   */
  applyDecay(): number {
    const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    // Set-based, in the engine. A loop cost 10.4s at 50,000 memories and 1.08s even batched into one
    // transaction, against the 500ms NFR-04 budget; materialising tens of thousands of entities to
    // multiply one number is the wrong shape (docs/evidence/nfr-bench.json).
    //
    // `decayMemory` remains the single-memory path and the readable statement of the formula. A test
    // pins the two implementations to the same answer, because two copies of a formula is exactly the
    // kind of duplication that drifts.
    return this.repo.decayOlderThan(cutoff, this.clock.now());
  }

  /**
   * Evaluate and apply tier promotions based on access count.
   *
   * Buffer → Working at ≥3 accesses, Working → Core at ≥10.
   *
   * @returns Number of memories promoted
   */
  evaluateTierPromotions(): number {
    // Set-based, for the same reason as applyDecay. Order matters and is subtle: working -> core runs
    // FIRST, so a memory promoted out of buffer in this pass cannot skip straight through to core on
    // the same pass. Running buffer -> working first would let a row with 10+ accesses cross two
    // tiers at once, which no tier rule describes.
    const toCore = this.repo.promoteTier('working', 'core', 10);
    const toWorking = this.repo.promoteTier('buffer', 'working', 3);
    return toCore + toWorking;
  }
}
