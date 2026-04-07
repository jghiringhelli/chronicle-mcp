/**
 * SQLite implementation of SessionRepository.
 */

import type Database from 'better-sqlite3';
import type { SessionRepository } from '../../ports/repositories/session-repository.js';
import type { Session, StartSessionInput } from '../../domain/entities/session.js';
import { startSession } from '../../domain/entities/session.js';
import type { SessionStatus } from '../../domain/entities/session.js';
import type { SessionId, ProjectId } from '../../domain/types.js';
import { StorageError } from '../../shared/exceptions/index.js';

interface SessionRow {
  id: string;
  project: string;
  device: string | null;
  status: string;
  started_at: string;
  ended_at: string | null;
  active_tasks: string;
  pending_decisions: string;
  touched_files: string;
  summary: string | null;
}

function rowToSession(row: SessionRow): Session {
  return {
    id: row.id,
    project: row.project,
    device: row.device ?? undefined,
    status: row.status as SessionStatus,
    startedAt: row.started_at,
    endedAt: row.ended_at ?? undefined,
    activeTasks: Object.freeze(JSON.parse(row.active_tasks) as string[]),
    pendingDecisions: Object.freeze(JSON.parse(row.pending_decisions) as string[]),
    touchedFiles: Object.freeze(JSON.parse(row.touched_files) as string[]),
    summary: row.summary ?? undefined,
  };
}

export class SqliteSessionRepository implements SessionRepository {
  constructor(private db: Database.Database) {}

  create(id: SessionId, input: StartSessionInput): Session {
    const session = startSession(id, input);
    try {
      this.db.prepare(`
        INSERT INTO sessions
          (id, project, device, status, started_at, ended_at,
           active_tasks, pending_decisions, touched_files, summary)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        session.id,
        session.project,
        session.device ?? null,
        session.status,
        session.startedAt,
        session.endedAt ?? null,
        JSON.stringify(session.activeTasks),
        JSON.stringify(session.pendingDecisions),
        JSON.stringify(session.touchedFiles),
        session.summary ?? null,
      );
    } catch (err) {
      throw new StorageError('Failed to create session', err);
    }
    return session;
  }

  findById(id: SessionId): Session | undefined {
    try {
      const row = this.db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as SessionRow | undefined;
      return row ? rowToSession(row) : undefined;
    } catch (err) {
      throw new StorageError('Failed to find session', err);
    }
  }

  findLatestByProject(project: ProjectId): Session | undefined {
    try {
      const row = this.db.prepare(`
        SELECT * FROM sessions WHERE project = ? ORDER BY started_at DESC LIMIT 1
      `).get(project) as SessionRow | undefined;
      return row ? rowToSession(row) : undefined;
    } catch (err) {
      throw new StorageError('Failed to find latest session', err);
    }
  }

  findActiveByProject(project: ProjectId): Session | undefined {
    try {
      const row = this.db.prepare(`
        SELECT * FROM sessions WHERE project = ? AND status = 'active' ORDER BY started_at DESC LIMIT 1
      `).get(project) as SessionRow | undefined;
      return row ? rowToSession(row) : undefined;
    } catch (err) {
      throw new StorageError('Failed to find active session', err);
    }
  }

  findCrashed(project?: ProjectId): Session[] {
    try {
      if (project) {
        const rows = this.db.prepare(`
          SELECT * FROM sessions WHERE status = 'crashed' AND project = ? ORDER BY started_at DESC
        `).all(project) as SessionRow[];
        return rows.map(rowToSession);
      }
      const rows = this.db.prepare(`
        SELECT * FROM sessions WHERE status = 'crashed' ORDER BY started_at DESC
      `).all() as SessionRow[];
      return rows.map(rowToSession);
    } catch (err) {
      throw new StorageError('Failed to find crashed sessions', err);
    }
  }

  update(session: Session): void {
    try {
      this.db.prepare(`
        UPDATE sessions SET
          project = ?, device = ?, status = ?, ended_at = ?,
          active_tasks = ?, pending_decisions = ?, touched_files = ?, summary = ?
        WHERE id = ?
      `).run(
        session.project,
        session.device ?? null,
        session.status,
        session.endedAt ?? null,
        JSON.stringify(session.activeTasks),
        JSON.stringify(session.pendingDecisions),
        JSON.stringify(session.touchedFiles),
        session.summary ?? null,
        session.id,
      );
    } catch (err) {
      throw new StorageError('Failed to update session', err);
    }
  }

  findRecentByProject(project: ProjectId, limit: number): Session[] {
    try {
      const rows = this.db.prepare(`
        SELECT * FROM sessions WHERE project = ? ORDER BY started_at DESC LIMIT ?
      `).all(project, limit) as SessionRow[];
      return rows.map(rowToSession);
    } catch (err) {
      throw new StorageError('Failed to find recent sessions', err);
    }
  }
}
