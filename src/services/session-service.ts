/**
 * SessionService — application-layer orchestration for session operations.
 */

import type { SessionRepository } from '../ports/repositories/session-repository.js';
import type { IdGenerator } from '../ports/gateways/id-generator.js';
import type { Clock } from '../ports/gateways/clock.js';
import type { Session } from '../domain/entities/session.js';
import { endSession as endSessionEntity } from '../domain/entities/session.js';
import { NotFoundError } from '../shared/exceptions/index.js';

export class SessionService {
  constructor(
    private repo: SessionRepository,
    private idGen: IdGenerator,
    private clock: Clock,
  ) {}

  /**
   * Start a new session.
   *
   * @param project - Project identifier
   * @param device - Optional device name
   * @returns Created session
   */
  startSession(project: string, device?: string): Session {
    const id = this.idGen.sessionId();
    const now = this.clock.now();
    return this.repo.create(id, { project, device, startedAt: now } as Parameters<SessionRepository['create']>[1]);
  }

  /**
   * End a session normally.
   *
   * @param id - Session identifier
   * @param summary - Optional summary of what was done
   * @returns Updated session
   * @throws {NotFoundError} If session not found
   */
  endSession(id: string, summary?: string): Session {
    const session = this.repo.findById(id);
    if (!session) throw new NotFoundError('Session', id);
    const ended = endSessionEntity(session, summary);
    this.repo.update(ended);
    return ended;
  }

  /**
   * Recover a session by ID.
   *
   * @param id - Session identifier
   * @returns Session or null if not found
   */
  recoverSession(id: string): Session | null {
    return this.repo.findById(id) ?? null;
  }

  /**
   * Get the active session for a project.
   *
   * @param project - Project identifier
   * @returns Active session or null
   */
  getActiveSession(project: string): Session | null {
    return this.repo.findActiveByProject(project) ?? null;
  }
}
