/**
 * Solution Repository Port
 *
 * Interface for solution library persistence.
 */

import type {
  Solution,
  SaveSolutionInput,
} from '../../domain/entities/solution.js';
import type {
  MemoryId,
  Embedding,
} from '../../domain/types.js';

/**
 * Solution search result with relevance score.
 */
export interface SolutionSearchResult {
  solution: Solution;
  score: number;
}

/**
 * Solution Repository Interface
 */
export interface SolutionRepository {
  /**
   * Save a new solution.
   *
   * @param id - Unique identifier for the solution
   * @param input - Solution save parameters
   * @returns The created solution
   */
  create(id: MemoryId, input: SaveSolutionInput): Solution;

  /**
   * Find solution by ID.
   *
   * @param id - Solution identifier
   * @returns Solution if found
   */
  findById(id: MemoryId): Solution | undefined;

  /**
   * Search solutions by problem description.
   *
   * @param problem - Problem description or query
   * @param embedding - Optional embedding for semantic search
   * @param language - Optional language filter
   * @param limit - Maximum results
   * @returns Ranked solutions
   */
  search(
    problem: string,
    embedding?: Embedding,
    language?: string,
    limit?: number
  ): SolutionSearchResult[];

  /**
   * Attach embedding to a solution.
   *
   * @param id - Solution identifier
   * @param embedding - Vector embedding
   */
  attachEmbedding(id: MemoryId, embedding: Embedding): void;

  /**
   * Count total solutions.
   *
   * @param language - Optional language filter
   * @returns Count of solutions
   */
  count(language?: string): number;
}
