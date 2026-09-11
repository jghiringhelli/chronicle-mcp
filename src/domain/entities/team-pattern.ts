/**
 * TeamPattern entity.
 *
 * Computed usage metric for a user within a team.
 * Self-visible to the user; aggregated anonymously for team stats.
 */

export type PatternType = 'prompt_category' | 'session_frequency' | 'contribution';
export type PatternPeriod = 'weekly' | 'monthly';

/** A computed usage pattern record */
export interface TeamPattern {
  readonly id: string;
  readonly userId: string;
  readonly teamId: string;
  readonly project?: string;
  readonly patternType: PatternType;
  /** What is being measured, e.g. "prompts_logged", "good_rate", "share_count" */
  readonly metric: string;
  readonly value: number;
  readonly period: PatternPeriod;
  readonly computedAt: string;
}
