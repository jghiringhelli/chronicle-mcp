/**
 * Team Repository Port
 *
 * The contract for the team cache tables: shared memories, distilled insights, per-user patterns,
 * the prompt-log buffer and the sync cursor.
 *
 * Why this file exists: four team services (`PatternService`, `PromptLogService`,
 * `TeamSyncService`, `TeamPromotionService`) were typed against the concrete
 * `SqliteTeamRepository` in the adapter layer. Dependency injection was already in place — the
 * instance is passed to the constructor — but depending on the concrete *type* still points a
 * service outward at an adapter, which `.claude/core.md` forbids and the lint gate caught on the
 * v0.4.0 merge. The fix is this port, not an exception.
 *
 * Every method is synchronous, like every other repository here: the ADR-001 decision is a
 * synchronous embedded database, and a promise in this contract would invalidate it.
 */

import type { TeamInsight } from '../../domain/entities/team-insight.js';
import type { TeamPattern } from '../../domain/entities/team-pattern.js';
import type { PromptLog } from '../../domain/entities/prompt-log.js';

/**
 * A memory another team member shared, as held in the local cache.
 *
 * Declared on the port rather than in the adapter because it is part of the contract: the adapter
 * imports it from here, which keeps the dependency pointing inward.
 */
export interface SharedCacheEntry {
  id: string;
  userId: string;
  teamId: string;
  project?: string;
  content: string;
  memoryType: string;
  tags: readonly string[];
  category?: string;
  sharedAt: string;
  updatedAt: string;
}

/**
 * Team cache persistence.
 *
 * Implementations MUST surface failures as `StorageError` and MUST NOT let a driver-specific
 * error escape, so a service never learns which database is underneath.
 */
export interface TeamRepository {
  // ── Shared memory cache ───────────────────────────────────────────────────

  /** Insert or replace a shared memory in the local cache. */
  upsertSharedCache(row: SharedCacheEntry): void;

  /**
   * Search the shared cache within one team.
   *
   * @param teamId - Team whose shared memories to search
   * @param query - Keyword query; matching is lexical, as in core recall (ADR-014)
   * @param project - Optional project filter
   * @param limit - Maximum rows to return
   */
  searchSharedCache(teamId: string, query: string, project?: string, limit?: number): SharedCacheEntry[];

  // ── Distilled team insights ───────────────────────────────────────────────

  /** Insert or replace a team insight, keyed by its natural identity. */
  upsertInsight(insight: TeamInsight): void;

  /** Every insight for a team, optionally narrowed to one project. */
  getInsights(teamId: string, project?: string): TeamInsight[];

  // ── Patterns ──────────────────────────────────────────────────────────────

  /** Insert or replace a pattern. */
  upsertPattern(pattern: TeamPattern): void;

  /** Patterns attributed to one contributor within a team. */
  getUserPatterns(userId: string, teamId: string): TeamPattern[];

  /** Every pattern held for a team. */
  getTeamPatterns(teamId: string): TeamPattern[];

  // ── Prompt log buffer ─────────────────────────────────────────────────────

  /** Queue a prompt-log entry for the next push. */
  bufferPromptLog(log: PromptLog): void;

  /** Entries queued and not yet pushed. */
  getPendingPromptLogs(): PromptLog[];

  /** Mark entries as pushed so they are not sent twice. */
  markPromptLogsPushed(ids: string[]): void;

  /** Count buffered entries by outcome, for a contributor within a team. */
  countPromptLogsByOutcome(userId: string, teamId: string): Record<string, number>;

  /** Count buffered entries by category, for a contributor within a team. */
  countPromptLogsByCategory(userId: string, teamId: string): Record<string, number>;

  // ── Sync cursor ───────────────────────────────────────────────────────────

  /**
   * When this contributor last pulled team state, or `undefined` on a first run.
   *
   * A first run MUST be treated as "pull everything" rather than "pull nothing" — the same epoch
   * floor the memory sync uses (EDR-003).
   */
  getLastPullAt(userId: string, teamId: string): string | undefined;

  /** Record the pull watermark. */
  setLastPullAt(userId: string, teamId: string, lastPullAt: string): void;
}
