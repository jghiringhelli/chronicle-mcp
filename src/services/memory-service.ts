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
import { lexicalScore, rankByScore } from './recall-ranker.js';

/** Results returned when the caller does not ask for a number. Matches the MCP tool's default. */
const DEFAULT_RECALL_LIMIT = 20;

/**
 * How many candidates to score per result asked for.
 *
 * The SQL `LIMIT` runs before any scoring, so whatever it cuts is gone — asking for exactly
 * `limit` rows would hand the ranker a set already filtered by weight, which is the ordering the
 * ranking exists to replace. Ten gives the scorer real choice while keeping the worst case
 * bounded: at the default limit it scores 200 rows, which is a fraction of a millisecond of
 * string work and well inside the recall budget (spec §5 NFR-03).
 */
const CANDIDATE_MULTIPLIER = 10;

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
   * Search memories, ranked by how well each one answers the query.
   *
   * Two stages, and the split is load-bearing. The repository decides **eligibility** with a
   * SQL filter; this method decides **order** by scoring each candidate against the query
   * text. Before the split there was no second stage: candidates came back ordered by
   * `weight DESC` and truncated in SQL, so the query never influenced the result at all and a
   * memory matching one word of five outranked one matching all five whenever it weighed more.
   * Over a labelled corpus that was MRR 0.26 and recall@5 0.42; scoring the same candidate set
   * took it to 0.76 and 0.83 (`docs/evidence/recall-experiment.json`).
   *
   * The candidate request deliberately asks for far more rows than the caller wants, because
   * the SQL `LIMIT` is applied before anything has scored: truncating by weight first discards
   * the best match, and no ranker can recover it afterwards.
   *
   * Ranking is synchronous and needs no embedding gateway. A vector path exists and is measured
   * — see `experiments/recall` — and is deliberately not the default: it wins only on
   * morphological near-misses, loses on paraphrase, and gives a non-zero similarity to
   * unrelated text, which costs the false-positive property this path has for free (a query
   * sharing no word with any memory scores zero and returns nothing).
   *
   * @param query - Search parameters
   * @returns Matching memories, best first, truncated to `query.limit`
   */
  recall(query: RecallQuery): Memory[] {
    const limit = query.limit ?? DEFAULT_RECALL_LIMIT;
    const candidates = this.repo.recall({ ...query, limit: CANDIDATE_MULTIPLIER * limit });
    if (candidates.length === 0) return [];

    // An empty query means "no text filter" (session start, distill): there is nothing to score
    // against, so the repository's weight order is the right answer and the only one available.
    if (query.query.trim().length === 0) return candidates.slice(0, limit).map(r => r.memory);

    const byId = new Map(candidates.map(c => [c.memory.id, c.memory]));
    const scored = candidates.map(c => ({
      id: c.memory.id,
      score: lexicalScore(query.query, {
        id: c.memory.id,
        content: c.memory.content,
        tags: c.memory.tags,
        category: c.memory.category,
        weight: c.memory.weight,
      }),
    }));

    return rankByScore(scored)
      .slice(0, limit)
      .flatMap(id => {
        const m = byId.get(id);
        return m ? [m] : [];
      });
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
