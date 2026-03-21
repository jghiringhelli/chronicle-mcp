/**
 * Preference Repository Port
 *
 * Interface for preference persistence operations.
 */

import type {
  Preference,
  SetPreferenceInput,
} from '../../domain/entities/preference.js';
import type {
  MemoryId,
  ProjectId,
} from '../../domain/types.js';

/**
 * Preference Repository Interface
 */
export interface PreferenceRepository {
  /**
   * Set a preference (create or update).
   *
   * @param id - Unique identifier for new preferences
   * @param input - Preference parameters
   * @returns The preference (created or updated)
   */
  set(id: MemoryId, input: SetPreferenceInput): Preference;

  /**
   * Find preference by key.
   *
   * @param key - Preference key
   * @param project - Optional project scope
   * @returns Preference if found
   */
  findByKey(key: string, project?: ProjectId): Preference | undefined;

  /**
   * Get preferences for a context.
   * Returns global preferences merged with project-specific ones.
   *
   * @param context - Optional context filter
   * @param project - Optional project filter
   * @returns Preferences (project overrides global)
   */
  getForContext(context?: string, project?: ProjectId): Preference[];

  /**
   * Get all global preferences.
   *
   * @returns All preferences without project scope
   */
  getGlobal(): Preference[];

  /**
   * Get all preferences for a project.
   *
   * @param project - Project identifier
   * @returns Project-specific preferences
   */
  getByProject(project: ProjectId): Preference[];

  /**
   * Delete a preference.
   *
   * @param key - Preference key
   * @param project - Optional project scope
   */
  delete(key: string, project?: ProjectId): void;
}
