/**
 * Memory Repository Port
 *
 * Interface for memory persistence operations.
 * Implemented by infrastructure layer (SQLite).
 */

import type {
  Memory,
  CreateMemoryInput,
} from '../../domain/entities/memory.js';
import type {
  MemoryId,
  MemoryScope,
  MemoryType,
  StorageTier,
  ProjectId,
  Embedding,
} from '../../domain/types.js';

/**
 * Search result with relevance score.
 */
export interface MemorySearchResult {
  memory: Memory;
  score: number; // Combined weight × similarity
}

/**
 * Query parameters for recall operations.
 */
export interface RecallQuery {
  query: string;
  embedding?: Embedding;
  project?: ProjectId;
  category?: string;
  memoryTypes?: MemoryType[];
  tiers?: StorageTier[];
  /**
   * Which scopes to search (ADR-018 §1). Omitted means every scope.
   *
   * The ordinary recall is `['project', 'person']` with `project` set to the repository identity:
   * what is true about this repo, plus what is true about me. `team` memories reach a caller through
   * the team surface, not through this one.
   */
  scopes?: MemoryScope[];
  limit?: number;
}

/**
 * Memory Repository Interface
 *
 * All methods are synchronous (better-sqlite3 is synchronous).
 * Performance requirement: <50ms for 10k memories.
 */
export interface MemoryRepository {
  /**
   * Store a new memory.
   *
   * @param id - Unique identifier for the memory
   * @param input - Memory creation parameters
   * @returns The created memory
   */
  create(id: MemoryId, input: CreateMemoryInput): Memory;

  /**
   * Find a memory by ID.
   *
   * @param id - Memory identifier
   * @returns Memory if found, undefined otherwise
   */
  findById(id: MemoryId): Memory | undefined;

  /**
   * Search memories using keyword + semantic search.
   *
   * @param query - Search parameters
   * @returns Ranked list of matching memories
   */
  recall(query: RecallQuery): MemorySearchResult[];

  /**
   * Update a memory (reinforcement, decay, promotion).
   *
   * @param memory - Updated memory entity
   */
  update(memory: Memory): void;

  /**
   * Apply exponential decay to every eligible memory in one set-based operation.
   *
   * The formula is EDR-001's and MUST be implemented exactly:
   *   `weight *= e^(-decayRate * daysSinceLastAccess)`
   * keyed on days since **last access**, never since creation.
   *
   * A memory with `decayRate = 0` MUST be left untouched — that is what makes `procedural`,
   * `architectural` and `insight` permanent by construction, and it must hold here as much as in the
   * domain function.
   *
   * Why this exists as a repository operation rather than a loop in the service: measured, the
   * row-by-row pass cost 10.4s at 50,000 memories, and 1.08s even batched into one transaction,
   * against the NFR-04 budget of 500ms. Materialising tens of thousands of entities to multiply one
   * number is the wrong shape. The service keeps the formula in the domain for the single-memory
   * path; this is the bulk path, and the two MUST agree — there is a test that pins them together.
   *
   * @param cutoff - Only memories last accessed before this ISO timestamp are decayed
   * @param now - The reference instant, as an ISO timestamp
   * @returns How many rows were changed
   */
  decayOlderThan(cutoff: string, now: string): number;

  /**
   * Promote every memory in `fromTier` that has reached `minAccess` into `toTier`, in one operation.
   *
   * Set-based for the same reason as `decayOlderThan`: the pass runs at every session end, and
   * materialising thousands of entities to change one string field was the remaining cost after the
   * decay was moved into the engine (NFR-04, docs/evidence/nfr-bench.json).
   *
   * Tier is otherwise only changed by an explicit promotion, never as a side effect of reinforcement
   * (EDR-001) — this is that explicit promotion, applied in bulk.
   *
   * @returns How many rows were promoted
   */
  promoteTier(fromTier: StorageTier, toTier: StorageTier, minAccess: number): number;

  /**
   * Update many memories as one unit.
   *
   * Not a convenience. Measured: the decay pass at 50,000 memories took **10.4 seconds** calling
   * `update` per row, because each statement autocommits — tens of thousands of transactions against
   * the NFR-04 budget of 500ms. A batch is the difference between a session that ends and one that
   * appears to hang.
   *
   * An implementation MUST apply the whole batch atomically: a half-applied decay pass leaves the
   * store in a state no weight formula describes.
   */
  updateMany(memories: readonly Memory[]): void;

  /**
   * Delete a memory.
   *
   * @param id - Memory identifier
   * @param reason - Reason for deletion (for audit)
   */
  /**
   * Remove a memory.
   *
   * @returns true when a row was removed, false when the id matched nothing. A miss is not an
   *   error — but it MUST be distinguishable from a delete, or a caller cannot tell a typo from a
   *   cleanup.
   */
  delete(id: MemoryId, reason: string): boolean;

  /**
   * Find memories that need decay processing.
   *
   * @param olderThan - Find memories not accessed since this timestamp
   * @returns Memories needing decay
   */
  findForDecay(olderThan: string): Memory[];

  /**
   * Find memories eligible for tier promotion.
   *
   * @param tier - Current tier
   * @param minAccessCount - Minimum access count for promotion
   * @returns Memories eligible for promotion
   */
  findForPromotion(tier: StorageTier, minAccessCount: number): Memory[];

  /**
   * Count memories by criteria.
   *
   * @param criteria - Optional filter criteria
   * @returns Count of matching memories
   */
  count(criteria?: {
    project?: ProjectId;
    memoryType?: MemoryType;
    tier?: StorageTier;
  }): number;

  /**
   * Attach embedding to a memory.
   *
   * @param id - Memory identifier
   * @param embedding - Vector embedding
   */
  attachEmbedding(id: MemoryId, embedding: Embedding): void;
}
