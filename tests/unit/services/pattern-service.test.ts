/**
 * Unit tests for PatternService.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PatternService } from '../../../src/services/pattern-service.js';
import type { SqliteTeamRepository } from '../../../src/adapters/repositories/sqlite-team-repository.js';

vi.mock('../../../src/shared/config/index.js', () => ({
  getConfig: () => ({ userId: 'user-1', teamId: 'team-a' }),
}));

class FakeTeamRepo {
  private outcomeCounts: Record<string, number>;
  private categoryCounts: Record<string, number>;
  private sharedMemories: unknown[];
  private teamInsights: unknown[];
  private patterns: unknown[];

  constructor({
    outcomeCounts = {},
    categoryCounts = {},
    sharedMemories = [],
    teamInsights = [],
    patterns = [],
  }: {
    outcomeCounts?: Record<string, number>;
    categoryCounts?: Record<string, number>;
    sharedMemories?: unknown[];
    teamInsights?: unknown[];
    patterns?: unknown[];
  } = {}) {
    this.outcomeCounts = outcomeCounts;
    this.categoryCounts = categoryCounts;
    this.sharedMemories = sharedMemories;
    this.teamInsights = teamInsights;
    this.patterns = patterns;
  }

  countPromptLogsByOutcome(_userId: string, _teamId: string) { return this.outcomeCounts; }
  countPromptLogsByCategory(_userId: string, _teamId: string) { return this.categoryCounts; }
  searchSharedCache(_teamId: string, _query: string, _project?: string, _limit?: number) { return this.sharedMemories; }
  getInsights(_teamId: string, _project?: string) { return this.teamInsights; }
  getTeamPatterns(_teamId: string) { return this.patterns; }
  getUserPatterns(_userId: string, _teamId: string) { return this.patterns; }
}

describe('PatternService', () => {
  describe('myStats', () => {
    it('returns zero stats when no logs exist', () => {
      const svc = new PatternService(new FakeTeamRepo() as unknown as SqliteTeamRepository);
      const stats = svc.myStats();
      expect(stats.totalLogged).toBe(0);
      expect(stats.goodRate).toBe(0);
      expect(stats.sharedMemoriesCount).toBe(0);
      expect(stats.userId).toBe('user-1');
      expect(stats.teamId).toBe('team-a');
    });

    it('computes goodRate correctly', () => {
      const svc = new PatternService(new FakeTeamRepo({
        outcomeCounts: { good: 3, bad: 1, neutral: 1 },
      }) as unknown as SqliteTeamRepository);
      const stats = svc.myStats();
      expect(stats.totalLogged).toBe(5);
      expect(stats.goodRate).toBe(0.6);
    });

    it('counts only own shared memories', () => {
      const svc = new PatternService(new FakeTeamRepo({
        sharedMemories: [
          { userId: 'user-1', content: 'x' },
          { userId: 'user-2', content: 'y' },
          { userId: 'user-1', content: 'z' },
        ],
      }) as unknown as SqliteTeamRepository);
      const stats = svc.myStats();
      expect(stats.sharedMemoriesCount).toBe(2);
    });
  });

  describe('teamStats', () => {
    it('returns empty stats for empty team', () => {
      const svc = new PatternService(new FakeTeamRepo() as unknown as SqliteTeamRepository);
      const stats = svc.teamStats();
      expect(stats.teamId).toBe('team-a');
      expect(stats.totalSharedMemories).toBe(0);
      expect(stats.memberPatterns).toHaveLength(0);
      expect(stats.topCategories).toHaveLength(0);
    });

    it('aggregates member contributions from shared memories', () => {
      const svc = new PatternService(new FakeTeamRepo({
        sharedMemories: [
          { userId: 'user-1', content: 'a' },
          { userId: 'user-1', content: 'b' },
          { userId: 'user-2', content: 'c' },
        ],
      }) as unknown as SqliteTeamRepository);
      const stats = svc.teamStats();
      expect(stats.totalSharedMemories).toBe(3);
      const u1 = stats.memberPatterns.find(p => p.userId === 'user-1');
      expect(u1?.contribution).toBe(2);
    });

    it('extracts top categories from prompt_category patterns', () => {
      const svc = new PatternService(new FakeTeamRepo({
        patterns: [
          { patternType: 'prompt_category', metric: 'refactoring', value: 10, userId: 'u1', teamId: 'team-a', id: '1', period: 'monthly', computedAt: '' },
          { patternType: 'prompt_category', metric: 'debugging', value: 5, userId: 'u1', teamId: 'team-a', id: '2', period: 'monthly', computedAt: '' },
        ],
      }) as unknown as SqliteTeamRepository);
      const stats = svc.teamStats();
      expect(stats.topCategories[0].category).toBe('refactoring');
      expect(stats.topCategories[0].count).toBe(10);
    });
  });
});
