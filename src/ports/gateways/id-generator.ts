/**
 * ID Generator Port
 *
 * Interface for generating unique identifiers.
 */

import type {
  MemoryId,
  TriggerId,
  SessionId,
} from '../../domain/types.js';

/**
 * ID Generator Interface
 *
 * Abstracts unique ID generation.
 * Implementations may use UUID, ULID, nanoid, etc.
 */
export interface IdGenerator {
  /**
   * Generate a unique memory ID.
   *
   * @returns New unique memory identifier
   */
  memoryId(): MemoryId;

  /**
   * Generate a unique trigger ID.
   *
   * @returns New unique trigger identifier
   */
  triggerId(): TriggerId;

  /**
   * Generate a unique session ID.
   *
   * @returns New unique session identifier
   */
  sessionId(): SessionId;
}
