/**
 * TeamSyncService - push team-shared memories and prompt log buffer to Railway;
 * pull team insights and shared memories into the local cache.
 *
 * Fires automatically at session_end (non-fatal). Can be triggered manually
 * via the team MCP tool.
 */

import { randomUUID } from 'node:crypto';
import { getConfig } from '../shared/config/index.js';
import type { SqliteTeamRepository } from '../adapters/repositories/sqlite-team-repository.js';
import type { PromptLogService } from './prompt-log-service.js';
import type { TeamInsight, TeamInsightType } from '../domain/entities/team-insight.js';
import type { TeamPattern } from '../domain/entities/team-pattern.js';
import { StorageError } from '../shared/exceptions/index.js';

/** Confidence assigned to a freshly curated team insight. */
const CURATED_INSIGHT_BASE_CONFIDENCE = 0.6;
/** Confidence increment each time an existing insight is re-curated/corroborated. */
const CONFIDENCE_STEP = 0.1;

export interface TeamSyncResult {
  sharedMemoriesPushed: number;
  promptLogsPushed: number;
  insightsPulled: number;
  sharedMemoriesPulled: number;
  patternsPulled: number;
  skipped: boolean;
}

export interface SharedMemoryInput {
  id: string;
  content: string;
  memoryType: string;
  tags: string[];
  category?: string;
  project?: string;
}

export class TeamSyncService {
  constructor(
    private teamRepo: SqliteTeamRepository,
    private promptLogSvc: PromptLogService,
  ) {}

  /**
   * Push a single memory to the team-shared pool on Railway.
   * Also upserts it into the local shared cache.
   *
   * @param memory - Memory to share with the team
   * @returns ID of the shared memory
   */
  async pushSharedMemory(memory: SharedMemoryInput): Promise<string> {
    const config = getConfig();
    if (!config.railwayUrl || !config.teamId) {
      throw new StorageError('railwayUrl or teamId not configured');
    }

    const { default: postgres } = await import('postgres');
    const sql = postgres(config.railwayUrl, { ssl: 'require', max: 2 });
    const now = new Date().toISOString();
    try {
      await sql`
        INSERT INTO team_shared_memories
          (id, user_id, team_id, project, content, memory_type, tags, category, shared_at, updated_at)
        VALUES (
          ${memory.id}, ${config.userId}, ${config.teamId},
          ${memory.project ?? null}, ${memory.content}, ${memory.memoryType},
          ${memory.tags}, ${memory.category ?? null}, ${now}, ${now}
        )
        ON CONFLICT (id) DO UPDATE SET
          content    = EXCLUDED.content,
          tags       = EXCLUDED.tags,
          updated_at = NOW()
      `;
      // Mirror into local cache
      this.teamRepo.upsertSharedCache({
        id: memory.id, userId: config.userId, teamId: config.teamId,
        project: memory.project, content: memory.content,
        memoryType: memory.memoryType, tags: Object.freeze(memory.tags),
        category: memory.category, sharedAt: now, updatedAt: now,
      });
      return memory.id;
    } catch (err) {
      throw new StorageError('Failed to push shared memory', err);
    } finally {
      await sql.end();
    }
  }

  /**
   * Create or reinforce a team-level insight on Railway (curation-gated to
   * owners/leads at the tool layer). Re-curating an existing (type, project)
   * insight bumps its confidence and version rather than duplicating it.
   * Mirrors the result into the local cache.
   *
   * @param input - Insight type, content, and optional project scope
   * @returns The created or updated insight
   */
  async pushInsight(input: { insightType: TeamInsightType; content: string; project?: string }): Promise<TeamInsight> {
    const config = getConfig();
    if (!config.railwayUrl || !config.teamId) {
      throw new StorageError('railwayUrl or teamId not configured');
    }

    const { default: postgres } = await import('postgres');
    const sql = postgres(config.railwayUrl, { ssl: 'require', max: 2 });
    const now = new Date().toISOString();
    try {
      // IS NOT DISTINCT FROM matches NULL project to NULL (plain = would not).
      const existing = await sql<{ id: string; source_count: number; confidence: number; version: number }[]>`
        SELECT id, source_count, confidence, version FROM team_insights
        WHERE team_id = ${config.teamId} AND insight_type = ${input.insightType}
          AND project IS NOT DISTINCT FROM ${input.project ?? null}
      `;

      let insight: TeamInsight;
      if (existing.length > 0) {
        const row = existing[0]!;
        const confidence = Math.min(1, row.confidence + CONFIDENCE_STEP);
        const version = row.version + 1;
        await sql`
          UPDATE team_insights
          SET content = ${input.content}, confidence = ${confidence}, version = ${version}, updated_at = ${now}
          WHERE id = ${row.id}
        `;
        insight = {
          id: row.id, teamId: config.teamId, project: input.project, insightType: input.insightType,
          content: input.content, confidence, sourceCount: row.source_count, version, updatedAt: now,
        };
      } else {
        const id = randomUUID();
        await sql`
          INSERT INTO team_insights (id, team_id, project, insight_type, content, confidence, source_count, version, updated_at)
          VALUES (${id}, ${config.teamId}, ${input.project ?? null}, ${input.insightType}, ${input.content}, ${CURATED_INSIGHT_BASE_CONFIDENCE}, 1, 1, ${now})
        `;
        insight = {
          id, teamId: config.teamId, project: input.project, insightType: input.insightType,
          content: input.content, confidence: CURATED_INSIGHT_BASE_CONFIDENCE, sourceCount: 1, version: 1, updatedAt: now,
        };
      }
      this.teamRepo.upsertInsight(insight);
      return insight;
    } catch (err) {
      throw new StorageError('Failed to push team insight', err);
    } finally {
      await sql.end();
    }
  }

  /**
   * Full team sync: push prompt buffer, pull insights + shared memories + patterns.
   *
   * @returns TeamSyncResult with counts
   */
  async sync(): Promise<TeamSyncResult> {
    const config = getConfig();
    if (!config.railwayUrl || !config.teamId) {
      return { sharedMemoriesPushed: 0, promptLogsPushed: 0, insightsPulled: 0, sharedMemoriesPulled: 0, patternsPulled: 0, skipped: true };
    }

    const { default: postgres } = await import('postgres');
    const sql = postgres(config.railwayUrl, { ssl: 'require', max: 3 });
    try {
      // Push prompt log buffer
      const promptLogsPushed = await this.promptLogSvc.pushBuffer();

      const since = this.teamRepo.getLastPullAt(config.userId, config.teamId) ?? '1970-01-01T00:00:00Z';

      // Pull team insights updated since last pull
      const remoteInsights = await sql<Record<string, unknown>[]>`
        SELECT id, team_id, project, insight_type, content, confidence, source_count, version, updated_at
        FROM team_insights
        WHERE team_id = ${config.teamId} AND updated_at > ${since}
        ORDER BY updated_at DESC
      `;
      for (const ri of remoteInsights) {
        this.teamRepo.upsertInsight({
          id: ri['id'] as string, teamId: ri['team_id'] as string,
          project: ri['project'] as string | undefined,
          insightType: ri['insight_type'] as TeamInsight['insightType'],
          content: ri['content'] as string, confidence: ri['confidence'] as number,
          sourceCount: ri['source_count'] as number, version: ri['version'] as number,
          updatedAt: ri['updated_at'] as string,
        });
      }

      // Pull team-shared memories updated since last pull (excluding own)
      const remoteShared = await sql<Record<string, unknown>[]>`
        SELECT id, user_id, team_id, project, content, memory_type, tags, category, shared_at, updated_at
        FROM team_shared_memories
        WHERE team_id = ${config.teamId}
          AND user_id != ${config.userId}
          AND updated_at > ${since}
        ORDER BY updated_at DESC
        LIMIT 200
      `;
      for (const rs of remoteShared) {
        const tags = Array.isArray(rs['tags']) ? (rs['tags'] as string[]) : [];
        this.teamRepo.upsertSharedCache({
          id: rs['id'] as string, userId: rs['user_id'] as string,
          teamId: rs['team_id'] as string, project: rs['project'] as string | undefined,
          content: rs['content'] as string, memoryType: rs['memory_type'] as string,
          tags: Object.freeze(tags), category: rs['category'] as string | undefined,
          sharedAt: rs['shared_at'] as string, updatedAt: rs['updated_at'] as string,
        });
      }

      // Pull team patterns updated since last pull
      const remotePatterns = await sql<Record<string, unknown>[]>`
        SELECT id, user_id, team_id, project, pattern_type, metric, value, period, computed_at
        FROM team_patterns
        WHERE team_id = ${config.teamId} AND computed_at > ${since}
        ORDER BY computed_at DESC
      `;
      for (const rp of remotePatterns) {
        this.teamRepo.upsertPattern({
          id: rp['id'] as string, userId: rp['user_id'] as string,
          teamId: rp['team_id'] as string, project: rp['project'] as string | undefined,
          patternType: rp['pattern_type'] as TeamPattern['patternType'],
          metric: rp['metric'] as string, value: rp['value'] as number,
          period: rp['period'] as TeamPattern['period'],
          computedAt: rp['computed_at'] as string,
        });
      }

      const now = new Date().toISOString();
      this.teamRepo.setLastPullAt(config.userId, config.teamId, now);

      return {
        sharedMemoriesPushed: 0,
        promptLogsPushed,
        insightsPulled: remoteInsights.length,
        sharedMemoriesPulled: remoteShared.length,
        patternsPulled: remotePatterns.length,
        skipped: false,
      };
    } catch (err) {
      throw new StorageError('Team sync failed', err);
    } finally {
      await sql.end();
    }
  }
}
