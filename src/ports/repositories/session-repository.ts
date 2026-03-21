/**
 * Session Repository Port
 *
 * Interface for session persistence operations.
 */

import type {
  Session,
  StartSessionInput,
} from '../../domain/entities/session.js';
import type {
  SessionId,
  ProjectId,
} from '../../domain/types.js';

/**
 * Session Repository Interface
 */
export interface SessionRepository {
  /**
   * Create a new session.
   *
   * @param id - Unique identifier for the session
   * @param input - Session start parameters
   * @returns The created session
   */
  create(id: SessionId, input: StartSessionInput): Session;

  /**
   * Find session by ID.
   *
   * @param id - Session identifier
   * @returns Session if found
   */
  findById(id: SessionId): Session | undefined;

  /**
   * Find the most recent session for a project.
   *
   * @param project - Project identifier
   * @returns Most recent session if exists
   */
  findLatestByProject(project: ProjectId): Session | undefined;

  /**
   * Find active session for a project.
   *
   * @param project - Project identifier
   * @returns Active session if exists
   */
  findActiveByProject(project: ProjectId): Session | undefined;

  /**
   * Find crashed sessions (for recovery).
   *
   * @param project - Optional project filter
   * @returns Crashed sessions
   */
  findCrashed(project?: ProjectId): Session[];

  /**
   * Update session state.
   *
   * @param session - Updated session entity
   */
  update(session: Session): void;

  /**
   * Get recent sessions for a project.
   *
   * @param project - Project identifier
   * @param limit - Maximum number to return
   * @returns Recent sessions
   */
  findRecentByProject(project: ProjectId, limit: number): Session[];
}
