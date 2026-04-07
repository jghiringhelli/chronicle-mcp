/**
 * PreferenceService — application-layer orchestration for preferences.
 */

import type { PreferenceRepository } from '../ports/repositories/preference-repository.js';
import type { IdGenerator } from '../ports/gateways/id-generator.js';
import type { Preference } from '../domain/entities/preference.js';
import type { PreferenceStrength } from '../domain/entities/preference.js';

export class PreferenceService {
  constructor(
    private repo: PreferenceRepository,
    private idGen: IdGenerator,
  ) {}

  /**
   * Set a preference (create or update).
   *
   * @param key - Preference key
   * @param value - Preference value
   * @param context - Optional context
   * @param strength - Preference strength
   * @param project - Optional project scope
   */
  setPreference(
    key: string,
    value: string,
    context?: string,
    strength?: string,
    project?: string,
  ): void {
    const id = this.idGen.memoryId();
    this.repo.set(id, {
      key,
      value,
      context,
      strength: (strength as PreferenceStrength) ?? 'moderate',
      project,
    });
  }

  /**
   * Get preferences, optionally filtered by project.
   *
   * @param project - Optional project scope
   * @returns List of preferences
   */
  getPreferences(project?: string): Preference[] {
    if (project) return this.repo.getForContext(undefined, project);
    return this.repo.getGlobal();
  }

  /**
   * Get preferences relevant to a context query.
   *
   * @param contextQuery - Context string to match
   * @param project - Optional project scope
   * @returns Relevant preferences
   */
  getRelevantPreferences(contextQuery: string, project?: string): Preference[] {
    return this.repo.getForContext(contextQuery, project);
  }
}
