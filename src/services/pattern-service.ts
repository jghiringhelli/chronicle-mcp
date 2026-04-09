/**
 * PatternService — compute usage patterns from local cache data.
 *
 * All computations read from SQLite only — no live Postgres queries.
 * Results are returned in-memory; callers can push them to Railway via TeamSyncService.
 */

import { getConfig } from '../shared/config/index.js';
import type { SqliteTeamRepository } from '../adapters/repositories/sqlite-team-repository.js';

export interface MyStatsResult {
  userId: string;
  teamId: string;
  totalLogged: number;
  byOutcome: Record<string, number>;
  byCategory: Record<string, number>;
  sharedMemoriesCount: number;
  goodRate: number;
}

export interface TeamStatsResult {
  teamId: string;
  totalSharedMemories: number;
  memberPatterns: Array<{
    userId: string;
    contribution: number;
    goodRate?: number;
  }>;
  topCategories: Array<{ category: string; count: number }>;
  insights: Array<{ insightType: string; content: string; confidence: number }>;
}

export class PatternService {
  constructor(private teamRepo: SqliteTeamRepository) {}

  /**
   * Compute personal usage stats for the current user.
   *
   * @param project - Optional project filter
   * @returns Self-stats based on local cache data
   */
  myStats(project?: string): MyStatsResult {
    const config = getConfig();
    const teamId = config.teamId ?? '';

    const byOutcome = this.teamRepo.countPromptLogsByOutcome(config.userId, teamId);
    const byCategory = this.teamRepo.countPromptLogsByCategory(config.userId, teamId);
    const totalLogged = Object.values(byOutcome).reduce((a, b) => a + b, 0);
    const goodCount = byOutcome['good'] ?? 0;
    const goodRate = totalLogged > 0 ? goodCount / totalLogged : 0;

    // Count shared memories authored by this user in local cache
    const shared = this.teamRepo.searchSharedCache(teamId, '', project, 1000);
    const sharedByMe = shared.filter(m => m.userId === config.userId).length;

    return {
      userId: config.userId,
      teamId,
      totalLogged,
      byOutcome,
      byCategory,
      sharedMemoriesCount: sharedByMe,
      goodRate: Math.round(goodRate * 100) / 100,
    };
  }

  /**
   * Compute aggregate team stats from local cache.
   *
   * @param project - Optional project filter
   * @returns Team-wide stats
   */
  teamStats(project?: string): TeamStatsResult {
    const config = getConfig();
    const teamId = config.teamId ?? '';

    const shared = this.teamRepo.searchSharedCache(teamId, '', project, 1000);
    const insights = this.teamRepo.getInsights(teamId, project);
    const allPatterns = this.teamRepo.getTeamPatterns(teamId);

    // Aggregate contributions per member
    const contributionMap = new Map<string, number>();
    for (const m of shared) {
      contributionMap.set(m.userId, (contributionMap.get(m.userId) ?? 0) + 1);
    }

    // Derive top categories from patterns
    const categoryMap = new Map<string, number>();
    for (const p of allPatterns) {
      if (p.patternType === 'prompt_category') {
        categoryMap.set(p.metric, (categoryMap.get(p.metric) ?? 0) + p.value);
      }
    }
    const topCategories = [...categoryMap.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([category, count]) => ({ category, count }));

    const memberPatterns = [...contributionMap.entries()].map(([userId, contribution]) => ({
      userId,
      contribution,
    }));

    return {
      teamId,
      totalSharedMemories: shared.length,
      memberPatterns,
      topCategories,
      insights: insights.map(i => ({
        insightType: i.insightType,
        content: i.content,
        confidence: i.confidence,
      })),
    };
  }
}
