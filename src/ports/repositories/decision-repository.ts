/**
 * Decision Repository Port
 *
 * Interface for architectural decision persistence.
 */

import type {
  Decision,
  RecordDecisionInput,
} from '../../domain/entities/decision.js';
import type {
  MemoryId,
  ProjectId,
  Embedding,
} from '../../domain/types.js';

/**
 * Decision search result with relevance score.
 */
export interface DecisionSearchResult {
  decision: Decision;
  score: number;
}

/**
 * Decision Repository Interface
 */
export interface DecisionRepository {
  /**
   * Record a new architectural decision.
   *
   * @param id - Unique identifier for the decision
   * @param input - Decision recording parameters
   * @returns The recorded decision
   */
  create(id: MemoryId, input: RecordDecisionInput): Decision;

  /**
   * Find decision by ID.
   *
   * @param id - Decision identifier
   * @returns Decision if found
   */
  findById(id: MemoryId): Decision | undefined;

  /**
   * Search decisions by query.
   *
   * @param query - Search query (topic, component name, etc.)
   * @param embedding - Optional embedding for semantic search
   * @param project - Optional project filter
   * @param since - Optional date filter
   * @returns Ranked decisions
   */
  search(
    query?: string,
    embedding?: Embedding,
    project?: ProjectId,
    since?: string
  ): DecisionSearchResult[];

  /**
   * Get all decisions for a project.
   *
   * @param project - Project identifier
   * @returns All decisions for the project
   */
  findByProject(project: ProjectId): Decision[];

  /**
   * Get decisions related to a topic.
   *
   * @param topic - Topic or component name
   * @param project - Optional project filter
   * @returns Decisions about the topic
   */
  findByTopic(topic: string, project?: ProjectId): Decision[];

  /**
   * Count decisions.
   *
   * @param project - Optional project filter
   * @returns Count of decisions
   */
  count(project?: ProjectId): number;
}
