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
import { TEAM_SCHEMA_SQL } from '../infrastructure/db/team-schema.js';

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
 * Sync team coordination state (Axon layer) with Railway.
 *
 * Coordination tables are team-shared, so Railway is the source of truth:
 *   PUSH  contributors, work_packages, assignments, merge_requests changed since last sync
 *   PULL  all team changes from other devices since last pull
 *
 * Called before and after Axon tool actions to keep all team members in sync.
 * Requires config.teamId and config.railwayUrl to be set.
 *
 * @param project  Optional project filter — syncs all projects if omitted.
 */
export async function syncCoordination(project?: string): Promise<SyncResult> {
  const config = getConfig();
  if (!config.railwayUrl) return { pushed: 0, pulled: 0, conflicts: 0, skipped: true };
  if (!config.teamId)     return { pushed: 0, pulled: 0, conflicts: 0, skipped: true };

  try {
    const { default: postgres } = await import('postgres');
    const sql = postgres(config.railwayUrl, { ssl: 'require', max: 3 });
    const db = getDatabase();

    // Ensure schema and team row exist
    await sql.unsafe(TEAM_SCHEMA_SQL);
    await sql`INSERT INTO teams (id, name) VALUES (${config.teamId}, ${config.teamId}) ON CONFLICT DO NOTHING`;

    const cursor = db.prepare(
      `SELECT last_push_at, last_pull_at FROM sync_cursor WHERE device_id = ? AND user_id = ?`,
    ).get(config.deviceId, config.userId) as { last_push_at: string | null; last_pull_at: string | null } | undefined;
    const lastPush = cursor?.last_push_at ?? '1970-01-01T00:00:00Z';
    const lastPull = cursor?.last_pull_at ?? '1970-01-01T00:00:00Z';
    const now = new Date().toISOString();

    let pushed = 0;
    let pulled = 0;

    // ── PUSH contributors ────────────────────────────────────────────────────
    const contributors = (project
      ? db.prepare(`SELECT * FROM contributors WHERE project = ? AND last_active_at > ?`).all(project, lastPush)
      : db.prepare(`SELECT * FROM contributors WHERE last_active_at > ?`).all(lastPush)
    ) as any[];

    for (const c of contributors) {
      await sql`
        INSERT INTO team_contributors
          (id, team_id, project, name, email, skills, role, bandwidth_hours_per_week,
           availability, last_active_at, created_at, updated_at, source_device)
        VALUES (
          ${c.id}, ${config.teamId}, ${c.project}, ${c.name}, ${c.email ?? null},
          ${JSON.parse(c.skills ?? '[]')}, ${c.role}, ${c.bandwidth_hours_per_week},
          ${c.availability}, ${c.last_active_at}, ${c.created_at}, ${now}, ${config.deviceId}
        )
        ON CONFLICT (id) DO UPDATE SET
          availability       = EXCLUDED.availability,
          last_active_at     = EXCLUDED.last_active_at,
          bandwidth_hours_per_week = EXCLUDED.bandwidth_hours_per_week,
          updated_at         = EXCLUDED.updated_at,
          source_device      = EXCLUDED.source_device
        WHERE EXCLUDED.last_active_at > team_contributors.last_active_at
      `;
      pushed++;
    }

    // ── PUSH work_packages ───────────────────────────────────────────────────
    const packages = (project
      ? db.prepare(`SELECT * FROM work_packages WHERE project = ? AND created_at > ?`).all(project, lastPush)
      : db.prepare(`SELECT * FROM work_packages WHERE created_at > ?`).all(lastPush)
    ) as any[];

    // Also push packages whose status changed (assigned, completed, etc.)
    const updatedPackages = (project
      ? db.prepare(`SELECT * FROM work_packages WHERE project = ? AND (assigned_at > ? OR completed_at > ?)`).all(project, lastPush, lastPush)
      : db.prepare(`SELECT * FROM work_packages WHERE assigned_at > ? OR completed_at > ?`).all(lastPush, lastPush)
    ) as any[];

    const allPackages = [...new Map([...packages, ...updatedPackages].map(p => [p.id, p])).values()];

    for (const p of allPackages) {
      await sql`
        INSERT INTO team_work_packages
          (id, team_id, project, title, description, spec_section, status, role_required,
           dependencies, priority_rank, parent_id, is_milestone, branch_name,
           forgecraft_score, forgecraft_tier, forgecraft_pass,
           assigned_to, assigned_at, completed_at, created_at, updated_at, source_device)
        VALUES (
          ${p.id}, ${config.teamId}, ${p.project}, ${p.title}, ${p.description},
          ${p.spec_section ?? null}, ${p.status}, ${p.role_required},
          ${JSON.parse(p.dependencies ?? '[]')}, ${p.priority_rank},
          ${p.parent_id ?? null}, ${p.is_milestone === 1},
          ${p.branch_name ?? null}, ${p.forgecraft_score ?? null},
          ${p.forgecraft_tier ?? null}, ${p.forgecraft_pass != null ? p.forgecraft_pass === 1 : null},
          ${p.assigned_to ?? null}, ${p.assigned_at ?? null}, ${p.completed_at ?? null},
          ${p.created_at}, ${now}, ${config.deviceId}
        )
        ON CONFLICT (id) DO UPDATE SET
          status         = EXCLUDED.status,
          assigned_to    = EXCLUDED.assigned_to,
          assigned_at    = EXCLUDED.assigned_at,
          completed_at   = EXCLUDED.completed_at,
          branch_name    = EXCLUDED.branch_name,
          forgecraft_score = EXCLUDED.forgecraft_score,
          forgecraft_tier  = EXCLUDED.forgecraft_tier,
          forgecraft_pass  = EXCLUDED.forgecraft_pass,
          updated_at     = EXCLUDED.updated_at,
          source_device  = EXCLUDED.source_device
      `;
      pushed++;
    }

    // ── PUSH merge_requests ──────────────────────────────────────────────────
    const mrs = (project
      ? db.prepare(`SELECT * FROM merge_requests WHERE project = ? AND created_at > ?`).all(project, lastPush)
      : db.prepare(`SELECT * FROM merge_requests WHERE created_at > ?`).all(lastPush)
    ) as any[];

    const updatedMrs = (project
      ? db.prepare(`SELECT * FROM merge_requests WHERE project = ? AND (approved_at > ? OR rejected_at > ?)`).all(project, lastPush, lastPush)
      : db.prepare(`SELECT * FROM merge_requests WHERE approved_at > ? OR rejected_at > ?`).all(lastPush, lastPush)
    ) as any[];

    const allMrs = [...new Map([...mrs, ...updatedMrs].map(m => [m.id, m])).values()];

    for (const m of allMrs) {
      await sql`
        INSERT INTO team_merge_requests
          (id, team_id, project, work_package_id, branch_name, from_contributor_id,
           forgecraft_score, forgecraft_tier, forgecraft_pass, forgecraft_report,
           approved_by, approved_at, rejected_by, rejected_at, rejection_reason,
           status, created_at, updated_at, source_device)
        VALUES (
          ${m.id}, ${config.teamId}, ${m.project}, ${m.work_package_id}, ${m.branch_name},
          ${m.from_contributor_id}, ${m.forgecraft_score ?? null}, ${m.forgecraft_tier ?? null},
          ${m.forgecraft_pass != null ? m.forgecraft_pass === 1 : null},
          ${m.forgecraft_report ?? null},
          ${m.approved_by ?? null}, ${m.approved_at ?? null},
          ${m.rejected_by ?? null}, ${m.rejected_at ?? null}, ${m.rejection_reason ?? null},
          ${m.status}, ${m.created_at}, ${now}, ${config.deviceId}
        )
        ON CONFLICT (id) DO UPDATE SET
          status          = EXCLUDED.status,
          approved_by     = EXCLUDED.approved_by,
          approved_at     = EXCLUDED.approved_at,
          rejected_by     = EXCLUDED.rejected_by,
          rejected_at     = EXCLUDED.rejected_at,
          rejection_reason = EXCLUDED.rejection_reason,
          updated_at      = EXCLUDED.updated_at,
          source_device   = EXCLUDED.source_device
        WHERE EXCLUDED.updated_at > team_merge_requests.updated_at
      `;
      pushed++;
    }

    // ── PULL all tables from other devices ───────────────────────────────────

    // Pull contributors
    const remoteContribs = await sql<any[]>`
      SELECT * FROM team_contributors
      WHERE team_id = ${config.teamId}
        AND updated_at > ${lastPull}
        AND source_device != ${config.deviceId}
        ${project ? sql`AND project = ${project}` : sql``}
    `;
    for (const rc of remoteContribs) {
      db.prepare(`
        INSERT OR REPLACE INTO contributors
          (id, project, name, email, skills, role, bandwidth_hours_per_week, availability, last_active_at, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        rc.id, rc.project, rc.name, rc.email ?? null,
        JSON.stringify(rc.skills ?? []), rc.role, rc.bandwidth_hours_per_week,
        rc.availability, rc.last_active_at, rc.created_at,
      );
      pulled++;
    }

    // Pull work packages
    const remotePackages = await sql<any[]>`
      SELECT * FROM team_work_packages
      WHERE team_id = ${config.teamId}
        AND updated_at > ${lastPull}
        AND source_device != ${config.deviceId}
        ${project ? sql`AND project = ${project}` : sql``}
    `;
    for (const rp of remotePackages) {
      db.prepare(`
        INSERT OR REPLACE INTO work_packages
          (id, project, title, description, spec_section, status, role_required,
           dependencies, priority_rank, parent_id, is_milestone, branch_name,
           forgecraft_score, forgecraft_tier, forgecraft_pass,
           assigned_to, assigned_at, completed_at, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        rp.id, rp.project, rp.title, rp.description, rp.spec_section ?? null,
        rp.status, rp.role_required, JSON.stringify(rp.dependencies ?? []),
        rp.priority_rank, rp.parent_id ?? null, rp.is_milestone ? 1 : 0,
        rp.branch_name ?? null, rp.forgecraft_score ?? null,
        rp.forgecraft_tier ?? null,
        rp.forgecraft_pass != null ? (rp.forgecraft_pass ? 1 : 0) : null,
        rp.assigned_to ?? null, rp.assigned_at ?? null,
        rp.completed_at ?? null, rp.created_at,
      );
      pulled++;
    }

    // Pull merge requests
    const remoteMrs = await sql<any[]>`
      SELECT * FROM team_merge_requests
      WHERE team_id = ${config.teamId}
        AND updated_at > ${lastPull}
        AND source_device != ${config.deviceId}
        ${project ? sql`AND project = ${project}` : sql``}
    `;
    for (const rm of remoteMrs) {
      db.prepare(`
        INSERT OR REPLACE INTO merge_requests
          (id, project, work_package_id, branch_name, from_contributor_id,
           forgecraft_score, forgecraft_tier, forgecraft_pass, forgecraft_report,
           approved_by, approved_at, rejected_by, rejected_at, rejection_reason,
           status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        rm.id, rm.project, rm.work_package_id, rm.branch_name, rm.from_contributor_id,
        rm.forgecraft_score ?? null, rm.forgecraft_tier ?? null,
        rm.forgecraft_pass != null ? (rm.forgecraft_pass ? 1 : 0) : null,
        rm.forgecraft_report ?? null,
        rm.approved_by ?? null, rm.approved_at ?? null,
        rm.rejected_by ?? null, rm.rejected_at ?? null, rm.rejection_reason ?? null,
        rm.status, rm.created_at,
      );
      pulled++;
    }

    // Update sync cursor
    db.prepare(`
      INSERT OR REPLACE INTO sync_cursor (device_id, user_id, last_push_at, last_pull_at, memories_version)
      VALUES (?, ?, ?, ?, COALESCE((SELECT memories_version FROM sync_cursor WHERE device_id=? AND user_id=?), 0))
    `).run(config.deviceId, config.userId, now, now, config.deviceId, config.userId);

    await sql.end();
    return { pushed, pulled, conflicts: 0, skipped: false };

  } catch (err) {
    // Non-fatal — coordination still works locally if Railway is down
    console.warn(`[chronicle] coordination sync failed: ${String(err)}`);
    return { pushed: 0, pulled: 0, conflicts: 0, skipped: true };
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
