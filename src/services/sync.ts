/**
 * SyncService — push/pull Chronicle data to/from Railway Postgres.
 *
 * Local-first: all operations work without cloud connectivity.
 * Sync is opportunistic — called at session boundaries.
 *
 * What syncs:
 *   PUSH  memories WHERE tier IN ('working','core')
 *   PUSH  insights (intelligence layer, LLM-distilled)
 *   PUSH  session summary on session_end
 *   PULL  memories updated since last_pull_at
 *   PULL  insights updated since last_pull_at
 *   PULL  recent session summaries (for cross-PC continuity)
 *
 * What never syncs:
 *   Buffer-tier memories (ephemeral, 7-day TTL)
 */

import type { Session } from '../domain/entities/session.js';
import { getConfig } from '../shared/config/index.js';
import { SyncError } from '../shared/exceptions/index.js';
import { getDatabase } from '../infrastructure/db/database.js';

export interface SyncResult {
  pushed: number;
  pulled: number;
  conflicts: number;
  skipped: boolean;   // true when railwayUrl not configured
}

export interface RemoteInsight {
  id: string;
  insightType: string;
  project: string | null;
  content: string;
  confidence: number;
  sourceCount: number;
  version: number;
  updatedAt: string;
}

/**
 * Push local working+core memories to Railway.
 * Pull remote memories updated since our last pull.
 *
 * @returns SyncResult with counts
 */
export async function syncMemories(): Promise<SyncResult> {
  const config = getConfig();
  if (!config.railwayUrl) return { pushed: 0, pulled: 0, conflicts: 0, skipped: true };

  try {
    const { default: postgres } = await import('postgres');
    const sql = postgres(config.railwayUrl, { ssl: 'require', max: 3 });
    const db  = getDatabase();

    // Ensure user row exists
    await sql`INSERT INTO users (id) VALUES (${config.userId}) ON CONFLICT DO NOTHING`;

    // --- PUSH -----------------------------------------------------------------
    const cursor = db.prepare(
      `SELECT last_push_at FROM sync_cursor WHERE device_id = ? AND user_id = ?`
    ).get(config.deviceId, config.userId) as { last_push_at: string | null } | undefined;

    const since = cursor?.last_push_at ?? '1970-01-01T00:00:00Z';

    const toSync = db.prepare(`
      SELECT * FROM memories
      WHERE (tier IN ('working','core') OR memory_type IN ('procedural','architectural'))
        AND (synced_at IS NULL OR synced_at < last_accessed_at OR created_at > ?)
    `).all(since) as Record<string, unknown>[];

    let pushed = 0;
    for (const m of toSync) {
      const tags = JSON.parse(m['tags'] as string ?? '[]') as string[];
      await sql`
        INSERT INTO memories (id, user_id, content, memory_type, tier, weight, decay_rate,
          access_count, created_at, last_accessed_at, project, category, tags, source,
          confirmed, fact_subject, fact_predicate, source_device, updated_at)
        VALUES (
          ${m['id'] as string}, ${config.userId}, ${m['content'] as string},
          ${m['memory_type'] as string}, ${m['tier'] as string}, ${m['weight'] as number},
          ${m['decay_rate'] as number}, ${m['access_count'] as number},
          ${m['created_at'] as string}, ${m['last_accessed_at'] as string},
          ${m['project'] as string | null}, ${m['category'] as string | null},
          ${tags}, ${m['source'] as string | null},
          ${Boolean(m['confirmed'])}, ${m['fact_subject'] as string | null},
          ${m['fact_predicate'] as string | null}, ${config.deviceId},
          NOW()
        )
        ON CONFLICT (id) DO UPDATE SET
          weight           = EXCLUDED.weight,
          access_count     = EXCLUDED.access_count,
          last_accessed_at = EXCLUDED.last_accessed_at,
          tier             = EXCLUDED.tier,
          updated_at       = NOW()
        WHERE EXCLUDED.last_accessed_at > memories.last_accessed_at
      `;
      db.prepare(`UPDATE memories SET synced_at = ? WHERE id = ?`)
        .run(new Date().toISOString(), m['id']);
      pushed++;
    }

    // --- PULL -----------------------------------------------------------------
    const lastPull = cursor?.last_push_at ?? '1970-01-01T00:00:00Z';
    const remote = await sql<Record<string, unknown>[]>`
      SELECT * FROM memories
      WHERE user_id = ${config.userId}
        AND updated_at > ${lastPull}
        AND source_device != ${config.deviceId}
    `;

    let pulled = 0;
    for (const rm of remote) {
      const existing = db.prepare(`SELECT last_accessed_at FROM memories WHERE id = ?`)
        .get(rm['id'] as string) as { last_accessed_at: string } | undefined;
      if (existing && existing.last_accessed_at >= (rm['last_accessed_at'] as string)) continue;

      const tags = Array.isArray(rm['tags']) ? JSON.stringify(rm['tags']) : '[]';
      db.prepare(`
        INSERT OR REPLACE INTO memories
          (id, content, memory_type, tier, weight, decay_rate, access_count,
           created_at, last_accessed_at, project, category, tags, source,
           confirmed, device_id, synced_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      `).run(
        rm['id'], rm['content'], rm['memory_type'], rm['tier'],
        rm['weight'], rm['decay_rate'], rm['access_count'],
        rm['created_at'], rm['last_accessed_at'], rm['project'],
        rm['category'], tags, rm['source'], rm['confirmed'] ? 1 : 0,
        rm['source_device'], new Date().toISOString()
      );
      pulled++;
    }

    // --- Update cursor ---------------------------------------------------------
    const now = new Date().toISOString();
    db.prepare(`
      INSERT OR REPLACE INTO sync_cursor (device_id, user_id, last_push_at, last_pull_at, memories_version)
      VALUES (?, ?, ?, ?, COALESCE((SELECT memories_version FROM sync_cursor WHERE device_id=? AND user_id=?), 0) + 1)
    `).run(config.deviceId, config.userId, now, now, config.deviceId, config.userId);

    await sql.end();
    return { pushed, pulled, conflicts: 0, skipped: false };

  } catch (err) {
    throw new SyncError(`Memory sync failed: ${String(err)}`, err);
  }
}

/**
 * Push local insights to Railway. Pull remote insights updated since last pull.
 * Last-writer-wins on version number.
 */
export async function syncInsights(): Promise<SyncResult> {
  const config = getConfig();
  if (!config.railwayUrl) return { pushed: 0, pulled: 0, conflicts: 0, skipped: true };

  try {
    const { default: postgres } = await import('postgres');
    const sql = postgres(config.railwayUrl, { ssl: 'require', max: 3 });
    const db  = getDatabase();

    await sql`INSERT INTO users (id) VALUES (${config.userId}) ON CONFLICT DO NOTHING`;

    // Push local insights
    const localInsights = db.prepare(`SELECT * FROM insights`).all() as Record<string, unknown>[];
    let pushed = 0;
    for (const ins of localInsights) {
      await sql`
        INSERT INTO insights (id, user_id, insight_type, project, content, confidence, source_count, version, updated_at)
        VALUES (${ins['id'] as string}, ${config.userId}, ${ins['insight_type'] as string},
                ${ins['project'] as string | null}, ${ins['content'] as string},
                ${ins['confidence'] as number}, ${ins['source_count'] as number},
                ${ins['version'] as number}, ${ins['updated_at'] as string})
        ON CONFLICT (user_id, insight_type, project) DO UPDATE SET
          content      = EXCLUDED.content,
          confidence   = EXCLUDED.confidence,
          source_count = EXCLUDED.source_count,
          version      = EXCLUDED.version,
          updated_at   = EXCLUDED.updated_at
        WHERE EXCLUDED.version > insights.version
      `;
      pushed++;
    }

    // Pull remote insights
    const cursor = db.prepare(
      `SELECT last_pull_at FROM sync_cursor WHERE device_id = ? AND user_id = ?`
    ).get(config.deviceId, config.userId) as { last_pull_at: string | null } | undefined;
    const since = cursor?.last_pull_at ?? '1970-01-01T00:00:00Z';

    const remote = await sql<Record<string, unknown>[]>`
      SELECT * FROM insights
      WHERE user_id = ${config.userId} AND updated_at > ${since}
    `;
    let pulled = 0;
    for (const ri of remote) {
      const local = db.prepare(`SELECT version FROM insights WHERE id = ?`).get(ri['id'] as string) as { version: number } | undefined;
      if (local && local.version >= (ri['version'] as number)) continue;
      db.prepare(`
        INSERT OR REPLACE INTO insights (id, insight_type, project, content, confidence, source_count, version, updated_at)
        VALUES (?,?,?,?,?,?,?,?)
      `).run(ri['id'], ri['insight_type'], ri['project'], ri['content'],
             ri['confidence'], ri['source_count'], ri['version'], ri['updated_at']);
      pulled++;
    }

    await sql.end();
    return { pushed, pulled, conflicts: 0, skipped: false };

  } catch (err) {
    throw new SyncError(`Insight sync failed: ${String(err)}`, err);
  }
}

/**
 * Push a completed session summary to Railway for cross-PC continuity.
 */
export async function pushSessionSummary(session: Session): Promise<void> {
  const config = getConfig();
  if (!config.railwayUrl || !session.summary) return;

  try {
    const { default: postgres } = await import('postgres');
    const sql = postgres(config.railwayUrl, { ssl: 'require', max: 1 });
    await sql`INSERT INTO users (id) VALUES (${config.userId}) ON CONFLICT DO NOTHING`;
    await sql`
      INSERT INTO session_summaries (id, user_id, project, device, summary, active_tasks, touched_files, started_at, ended_at)
      VALUES (
        ${session.id}, ${config.userId}, ${session.project}, ${config.deviceId},
        ${session.summary ?? ''},
        ${JSON.stringify(session.activeTasks)},
        ${JSON.stringify(session.touchedFiles)},
        ${session.startedAt}, ${session.endedAt ?? new Date().toISOString()}
      )
      ON CONFLICT (id) DO NOTHING
    `;
    await sql.end();
  } catch (err) {
    // Non-fatal — local session end should succeed even if sync fails
    console.warn(`[chronicle] session summary sync failed: ${String(err)}`);
  }
}

/**
 * Pull the last N session summaries for a project from Railway.
 * Used at session_start to surface "what were you working on last time?"
 */
export async function pullRecentSessions(project: string, limit = 3): Promise<{
  summary: string; device: string | null; endedAt: string;
}[]> {
  const config = getConfig();
  if (!config.railwayUrl) return [];

  try {
    const { default: postgres } = await import('postgres');
    const sql = postgres(config.railwayUrl, { ssl: 'require', max: 1 });
    const rows = await sql<{ summary: string; device: string | null; ended_at: string }[]>`
      SELECT summary, device, ended_at
      FROM session_summaries
      WHERE user_id = ${config.userId}
        AND project  = ${project}
        AND device  != ${config.deviceId}
      ORDER BY ended_at DESC
      LIMIT ${limit}
    `;
    await sql.end();
    return rows.map(r => ({ summary: r.summary, device: r.device, endedAt: r.ended_at }));
  } catch {
    return [];
  }
}
