/**
 * Trigger Repository Port
 *
 * Interface for trigger persistence operations.
 */

import type {
  Trigger,
  CreateTriggerInput,
} from '../../domain/entities/trigger.js';
import type {
  TriggerId,
  MemoryId,
  TriggerAction,
  ProjectId,
} from '../../domain/types.js';
import type { Memory } from '../../domain/entities/memory.js';

/**
 * Trigger check result with associated memory.
 */
export interface TriggerCheckResult {
  trigger: Trigger;
  memory: Memory;
}

/**
 * Trigger Repository Interface
 */
export interface TriggerRepository {
  /**
   * Create a new trigger.
   *
   * @param id - Unique identifier for the trigger
   * @param input - Trigger creation parameters
   * @returns The created trigger
   */
  create(id: TriggerId, input: CreateTriggerInput): Trigger;

  /**
   * Find triggers by action and project.
   * Returns triggers with their associated memories.
   *
   * @param action - Action to check
   * @param project - Optional project scope
   * @returns Matching triggers with memories
   */
  checkTriggers(action: TriggerAction, project?: ProjectId): TriggerCheckResult[];

  /**
   * Find trigger by ID.
   *
   * @param id - Trigger identifier
   * @returns Trigger if found
   */
  findById(id: TriggerId): Trigger | undefined;

  /**
   * Find triggers for a memory.
   *
   * @param memoryId - Memory identifier
   * @returns Triggers attached to the memory
   */
  findByMemoryId(memoryId: MemoryId): Trigger[];

  /**
   * Deactivate a trigger.
   *
   * @param id - Trigger identifier
   */
  deactivate(id: TriggerId): void;

  /**
   * Delete triggers for a memory.
   *
   * @param memoryId - Memory identifier
   */
  deleteByMemoryId(memoryId: MemoryId): void;
}
