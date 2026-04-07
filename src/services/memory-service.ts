/**
 * MemoryService — application-layer orchestration for memory operations.
 */

import type { MemoryRepository } from '../ports/repositories/memory-repository.js';
import type { RecallQuery } from '../ports/repositories/memory-repository.js';
import type { IdGenerator } from '../ports/gateways/id-generator.js';
import type { Clock } from '../ports/gateways/clock.js';
import type { Memory, CreateMemoryInput } from '../domain/entities/memory.js';
import { reinforceMemory, decayMemory, promoteMemory } from '../domain/entities/memory.js';
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
  forget(id: string, reason?: string): void {
    this.repo.delete(id, reason ?? 'forgotten');
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
    const memories = this.repo.findForDecay(cutoff);
    for (const memory of memories) {
      const days = this.clock.daysBetween(memory.lastAccessedAt, this.clock.now());
      const decayed = decayMemory(memory, days);
      this.repo.update(decayed);
    }
    return memories.length;
  }

  /**
   * Evaluate and apply tier promotions based on access count.
   *
   * Buffer → Working at ≥3 accesses, Working → Core at ≥10.
   *
   * @returns Number of memories promoted
   */
  evaluateTierPromotions(): number {
    let count = 0;
    const bufferCandidates = this.repo.findForPromotion('buffer', 3);
    for (const memory of bufferCandidates) {
      this.repo.update(promoteMemory(memory, 'working'));
      count++;
    }
    const workingCandidates = this.repo.findForPromotion('working', 10);
    for (const memory of workingCandidates) {
      this.repo.update(promoteMemory(memory, 'core'));
      count++;
    }
    return count;
  }
}
