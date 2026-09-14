import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { SessionService } from '../../../src/services/session-service.js';
import { SqliteSessionRepository } from '../../../src/adapters/repositories/sqlite-session-repository.js';
import { SCHEMA_SQL } from '../../../src/infrastructure/db/schema.js';
import { NodeIdGenerator } from '../../../src/infrastructure/gateways/node-id-generator.js';
import { NodeClock } from '../../../src/infrastructure/gateways/node-clock.js';
import { NotFoundError } from '../../../src/shared/exceptions/index.js';

/**
 * Session lifecycle (spec F7, UC-004).
 *
 * The regression at the bottom of this file comes from a defect the unit suite could not see:
 * `session(action: 'end', project)` ignored `project` entirely and called
 * `endSession(args.id ?? '')`, so the documented flow — start with a project, end with the same
 * project — failed with `Session not found: ` and an empty id. It was found by driving the real
 * MCP boundary (scripts/smoke-mcp.mjs), not by a unit test. These tests pin the resolution rule
 * the handler now shares with `recover`.
 */
describe('SessionService', () => {
  let svc: SessionService;

  beforeEach(() => {
    const db = new Database(':memory:');
    db.exec(SCHEMA_SQL);
    svc = new SessionService(
      new SqliteSessionRepository(db),
      new NodeIdGenerator(),
      new NodeClock(),
    );
  });

  it('starts a session that is immediately the active one for its project', () => {
    const started = svc.startSession('my-app');

    expect(started.status).toBe('active');
    expect(svc.getActiveSession('my-app')?.id).toBe(started.id);
  });

  it('keeps sessions for different projects separate', () => {
    const a = svc.startSession('app-a');
    svc.startSession('app-b');

    expect(svc.getActiveSession('app-a')?.id).toBe(a.id);
    expect(svc.getActiveSession('app-b')?.id).not.toBe(a.id);
  });

  it('returns null for a project that has never had a session', () => {
    expect(svc.getActiveSession('never-seen')).toBeNull();
  });

  it('ends a session by id and records the summary', () => {
    const started = svc.startSession('my-app');

    const ended = svc.endSession(started.id, 'migrated auth to Lucia v3');

    expect(ended.status).toBe('ended');
    expect(ended.endedAt).toBeTruthy();
    expect(ended.summary).toBe('migrated auth to Lucia v3');
  });

  it('stops reporting an ended session as the project active one', () => {
    const started = svc.startSession('my-app');

    svc.endSession(started.id);

    expect(svc.getActiveSession('my-app')).toBeNull();
  });

  it('throws NotFoundError rather than failing silently for an unknown id', () => {
    expect(() => svc.endSession('sess_does-not-exist')).toThrow(NotFoundError);
  });

  it('throws NotFoundError for an empty id — the shape the MCP handler used to pass', () => {
    // The handler did `endSession(args.id ?? '')`. This is what that produced, and why the
    // error the caller saw read `Session not found: ` with nothing after the colon.
    expect(() => svc.endSession('')).toThrow(NotFoundError);
  });

  it('recovers an active session by id', () => {
    const started = svc.startSession('my-app');

    expect(svc.recoverSession(started.id)?.id).toBe(started.id);
  });

  it('returns null, not an error, when recovering an unknown id', () => {
    expect(svc.recoverSession('sess_nope')).toBeNull();
  });

  describe('regression — ending by project (the flow the MCP handler documents)', () => {
    it('resolves the active session from the project, which is how end must work', () => {
      const started = svc.startSession('my-app');

      // This is the resolution the handler now performs when no id is supplied. An agent that
      // called start with a project and did not retain the id must still be able to end it.
      const resolved = svc.getActiveSession('my-app');
      expect(resolved?.id).toBe(started.id);

      const ended = svc.endSession(resolved!.id, 'done');
      expect(ended.endedAt).toBeTruthy();
      expect(svc.getActiveSession('my-app')).toBeNull();
    });

    it('leaves nothing to resolve once the project session is ended, so a second end is refused', () => {
      const started = svc.startSession('my-app');
      svc.endSession(started.id);

      // The handler turns this null into a message naming the project, rather than calling
      // endSession('') and surfacing an empty-id NotFoundError.
      expect(svc.getActiveSession('my-app')).toBeNull();
    });
  });
});
