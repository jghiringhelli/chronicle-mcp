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
   * Delete a memory.
   *
   * @param id - Memory identifier
   * @param reason - Reason for deletion (for audit)
   */
  delete(id: MemoryId, reason: string): void;

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
