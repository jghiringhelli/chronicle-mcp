/**
 * TeamInsight entity.
 *
 * Synthesized team-level intelligence aggregated from shared memories
 * and prompt logs. Written by TeamSyncService after pulling from Railway.
 */

export type TeamInsightType = 'practice' | 'antipattern' | 'profile' | 'lesson';

/** A synthesized team insight, cached locally after sync */
export interface TeamInsight {
  readonly id: string;
  readonly teamId: string;
  readonly project?: string;
  readonly insightType: TeamInsightType;
  readonly content: string;
  readonly confidence: number;
  readonly sourceCount: number;
  readonly version: number;
  readonly updatedAt: string;
}
