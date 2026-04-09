/**
 * SQLite repository for all team cache tables.
 *
 * Covers: team_shared_cache, team_insights_cache, team_patterns_cache,
 *         prompt_log_buffer, team_sync_cursor.
 */

import type Database from 'better-sqlite3';
import type { TeamInsight } from '../../domain/entities/team-insight.js';
import type { TeamPattern } from '../../domain/entities/team-pattern.js';
import type { PromptLog } from '../../domain/entities/prompt-log.js';
import { StorageError } from '../../shared/exceptions/index.js';

// ── Row types ─────────────────────────────────────────────────────────────────

interface SharedCacheRow {
  id: string; user_id: string; team_id: string; project: string | null;
  content: string; memory_type: string; tags: string; category: string | null;
  shared_at: string; updated_at: string;
}

interface InsightsCacheRow {
  id: string; team_id: string; project: string | null; insight_type: string;
  content: string; confidence: number; source_count: number; version: number; updated_at: string;
}

interface PatternsCacheRow {
  id: string; user_id: string; team_id: string; project: string | null;
  pattern_type: string; metric: string; value: number; period: string; computed_at: string;
}

interface PromptLogRow {
  id: string; user_id: string; team_id: string; project: string | null;
  pattern: string; outcome: string; category: string; tags: string;
  share_content: number; raw_content: string | null; logged_at: string; status: string;
}

// ── Mappers ───────────────────────────────────────────────────────────────────

function rowToSharedCache(row: SharedCacheRow) {
  return {
    id: row.id, userId: row.user_id, teamId: row.team_id,
    project: row.project ?? undefined, content: row.content,
    memoryType: row.memory_type,
    tags: Object.freeze(JSON.parse(row.tags) as string[]),
    category: row.category ?? undefined,
    sharedAt: row.shared_at, updatedAt: row.updated_at,
  };
}

function rowToInsight(row: InsightsCacheRow): TeamInsight {
  return {
    id: row.id, teamId: row.team_id, project: row.project ?? undefined,
    insightType: row.insight_type as TeamInsight['insightType'],
    content: row.content, confidence: row.confidence,
    sourceCount: row.source_count, version: row.version, updatedAt: row.updated_at,
  };
}

function rowToPattern(row: PatternsCacheRow): TeamPattern {
  return {
    id: row.id, userId: row.user_id, teamId: row.team_id,
    project: row.project ?? undefined,
    patternType: row.pattern_type as TeamPattern['patternType'],
    metric: row.metric, value: row.value,
    period: row.period as TeamPattern['period'], computedAt: row.computed_at,
  };
}

function rowToPromptLog(row: PromptLogRow): PromptLog {
  return {
    id: row.id, userId: row.user_id, teamId: row.team_id,
    project: row.project ?? undefined,
    pattern: row.pattern, outcome: row.outcome as PromptLog['outcome'],
    category: row.category,
    tags: Object.freeze(JSON.parse(row.tags) as string[]),
    shareContent: !!row.share_content, rawContent: row.raw_content ?? undefined,
    loggedAt: row.logged_at, status: row.status as PromptLog['status'],
  };
}

// ── Repository ────────────────────────────────────────────────────────────────

export class SqliteTeamRepository {
  constructor(private db: Database.Database) {}

  // ── Shared cache ────────────────────────────────────────────────────────────

  /**
   * Upsert a team-shared memory into the local cache.
   *
   * @param row - Shared memory data from Railway
   */
  upsertSharedCache(row: ReturnType<typeof rowToSharedCache>): void {
    try {
      this.db.prepare(`
        INSERT OR REPLACE INTO team_shared_cache
          (id, user_id, team_id, project, content, memory_type, tags, category, shared_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        row.id, row.userId, row.teamId, row.project ?? null,
        row.content, row.memoryType, JSON.stringify(row.tags),
        row.category ?? null, row.sharedAt, row.updatedAt,
      );
    } catch (err) {
      throw new StorageError('Failed to upsert shared cache', err);
    }
  }

  /**
   * Search team-shared memories in the local cache.
   *
   * @param teamId - Team to search within
   * @param query - Text query
   * @param project - Optional project filter
   * @param limit - Max results
   * @returns Matching shared memories
   */
  searchSharedCache(teamId: string, query: string, project?: string, limit = 20) {
    try {
      const params: unknown[] = [`%${query}%`, `%${query}%`, teamId];
      let sql = `
        SELECT * FROM team_shared_cache
        WHERE (content LIKE ? OR tags LIKE ?) AND team_id = ?
      `;
      if (project) { sql += ' AND project = ?'; params.push(project); }
      sql += ' ORDER BY updated_at DESC LIMIT ?';
      params.push(limit);
      return (this.db.prepare(sql).all(...params) as SharedCacheRow[]).map(rowToSharedCache);
    } catch (err) {
      throw new StorageError('Failed to search shared cache', err);
    }
  }

  // ── Insights cache ──────────────────────────────────────────────────────────

  /**
   * Upsert a team insight into the local cache.
   *
   * @param insight - TeamInsight to store
   */
  upsertInsight(insight: TeamInsight): void {
    try {
      this.db.prepare(`
        INSERT OR REPLACE INTO team_insights_cache
          (id, team_id, project, insight_type, content, confidence, source_count, version, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        insight.id, insight.teamId, insight.project ?? null, insight.insightType,
        insight.content, insight.confidence, insight.sourceCount, insight.version, insight.updatedAt,
      );
    } catch (err) {
      throw new StorageError('Failed to upsert insight', err);
    }
  }

  /**
   * Get all team insights for a team, optionally filtered by project.
   *
   * @param teamId - Team identifier
   * @param project - Optional project filter
   * @returns Team insights
   */
  getInsights(teamId: string, project?: string): TeamInsight[] {
    try {
      if (project) {
        return (this.db.prepare(
          'SELECT * FROM team_insights_cache WHERE team_id = ? AND (project = ? OR project IS NULL) ORDER BY confidence DESC'
        ).all(teamId, project) as InsightsCacheRow[]).map(rowToInsight);
      }
      return (this.db.prepare(
        'SELECT * FROM team_insights_cache WHERE team_id = ? ORDER BY confidence DESC'
      ).all(teamId) as InsightsCacheRow[]).map(rowToInsight);
    } catch (err) {
      throw new StorageError('Failed to get insights', err);
    }
  }

  // ── Patterns cache ──────────────────────────────────────────────────────────

  /**
   * Upsert a team pattern into the local cache.
   *
   * @param pattern - TeamPattern to store
   */
  upsertPattern(pattern: TeamPattern): void {
    try {
      this.db.prepare(`
        INSERT OR REPLACE INTO team_patterns_cache
          (id, user_id, team_id, project, pattern_type, metric, value, period, computed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        pattern.id, pattern.userId, pattern.teamId, pattern.project ?? null,
        pattern.patternType, pattern.metric, pattern.value, pattern.period, pattern.computedAt,
      );
    } catch (err) {
      throw new StorageError('Failed to upsert pattern', err);
    }
  }

  /**
   * Get patterns for a specific user in a team.
   *
   * @param userId - User identifier
   * @param teamId - Team identifier
   * @returns User's patterns
   */
  getUserPatterns(userId: string, teamId: string): TeamPattern[] {
    try {
      return (this.db.prepare(
        'SELECT * FROM team_patterns_cache WHERE user_id = ? AND team_id = ? ORDER BY computed_at DESC'
      ).all(userId, teamId) as PatternsCacheRow[]).map(rowToPattern);
    } catch (err) {
      throw new StorageError('Failed to get user patterns', err);
    }
  }

  /**
   * Get aggregated patterns for a team (all members).
   *
   * @param teamId - Team identifier
   * @returns All team patterns
   */
  getTeamPatterns(teamId: string): TeamPattern[] {
    try {
      return (this.db.prepare(
        'SELECT * FROM team_patterns_cache WHERE team_id = ? ORDER BY computed_at DESC'
      ).all(teamId) as PatternsCacheRow[]).map(rowToPattern);
    } catch (err) {
      throw new StorageError('Failed to get team patterns', err);
    }
  }

  // ── Prompt log buffer ───────────────────────────────────────────────────────

  /**
   * Insert a prompt log into the local pending buffer.
   *
   * @param log - PromptLog to buffer
   */
  bufferPromptLog(log: PromptLog): void {
    try {
      this.db.prepare(`
        INSERT INTO prompt_log_buffer
          (id, user_id, team_id, project, pattern, outcome, category, tags,
           share_content, raw_content, logged_at, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        log.id, log.userId, log.teamId, log.project ?? null,
        log.pattern, log.outcome, log.category, JSON.stringify(log.tags),
        log.shareContent ? 1 : 0, log.rawContent ?? null,
        log.loggedAt, log.status,
      );
    } catch (err) {
      throw new StorageError('Failed to buffer prompt log', err);
    }
  }

  /**
   * Get all pending prompt logs for push.
   *
   * @returns Pending prompt logs
   */
  getPendingPromptLogs(): PromptLog[] {
    try {
      return (this.db.prepare(
        "SELECT * FROM prompt_log_buffer WHERE status = 'pending' ORDER BY logged_at ASC"
      ).all() as PromptLogRow[]).map(rowToPromptLog);
    } catch (err) {
      throw new StorageError('Failed to get pending prompt logs', err);
    }
  }

  /**
   * Mark prompt logs as pushed by IDs.
   *
   * @param ids - IDs to mark pushed
   */
  markPromptLogsPushed(ids: string[]): void {
    if (ids.length === 0) return;
    try {
      const placeholders = ids.map(() => '?').join(', ');
      this.db.prepare(`UPDATE prompt_log_buffer SET status = 'pushed' WHERE id IN (${placeholders})`).run(...ids);
    } catch (err) {
      throw new StorageError('Failed to mark prompt logs pushed', err);
    }
  }

  /**
   * Count prompt logs by outcome for a user in a team.
   *
   * @param userId - User identifier
   * @param teamId - Team identifier
   * @returns Counts by outcome
   */
  countPromptLogsByOutcome(userId: string, teamId: string): Record<string, number> {
    try {
      const rows = this.db.prepare(
        'SELECT outcome, COUNT(*) as cnt FROM prompt_log_buffer WHERE user_id = ? AND team_id = ? GROUP BY outcome'
      ).all(userId, teamId) as { outcome: string; cnt: number }[];
      return Object.fromEntries(rows.map(r => [r.outcome, r.cnt]));
    } catch (err) {
      throw new StorageError('Failed to count prompt logs', err);
    }
  }

  /**
   * Count prompt logs by category for a user in a team.
   *
   * @param userId - User identifier
   * @param teamId - Team identifier
   * @returns Counts by category
   */
  countPromptLogsByCategory(userId: string, teamId: string): Record<string, number> {
    try {
      const rows = this.db.prepare(
        'SELECT category, COUNT(*) as cnt FROM prompt_log_buffer WHERE user_id = ? AND team_id = ? GROUP BY category'
      ).all(userId, teamId) as { category: string; cnt: number }[];
      return Object.fromEntries(rows.map(r => [r.category, r.cnt]));
    } catch (err) {
      throw new StorageError('Failed to count prompt logs by category', err);
    }
  }

  // ── Team sync cursor ────────────────────────────────────────────────────────

  /**
   * Get the last pull timestamp for a user/team pair.
   *
   * @param userId - User identifier
   * @param teamId - Team identifier
   * @returns Last pull timestamp or undefined
   */
  getLastPullAt(userId: string, teamId: string): string | undefined {
    try {
      const row = this.db.prepare(
        'SELECT last_pull_at FROM team_sync_cursor WHERE user_id = ? AND team_id = ?'
      ).get(userId, teamId) as { last_pull_at: string | null } | undefined;
      return row?.last_pull_at ?? undefined;
    } catch (err) {
      throw new StorageError('Failed to get team sync cursor', err);
    }
  }

  /**
   * Update the last pull timestamp for a user/team pair.
   *
   * @param userId - User identifier
   * @param teamId - Team identifier
   * @param lastPullAt - New timestamp
   */
  setLastPullAt(userId: string, teamId: string, lastPullAt: string): void {
    try {
      this.db.prepare(`
        INSERT OR REPLACE INTO team_sync_cursor (user_id, team_id, last_pull_at)
        VALUES (?, ?, ?)
      `).run(userId, teamId, lastPullAt);
    } catch (err) {
      throw new StorageError('Failed to set team sync cursor', err);
    }
  }
}
