import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { CoordinationService } from '../../../src/services/coordination-service.js';
import type { DecomposeInput } from '../../../src/services/coordination-service.js';
import { SCHEMA_SQL } from '../../../src/infrastructure/db/schema.js';

/**
 * A contributor can be an AI session, and the queue reaches across projects.
 *
 * `axon` shipped in April with `decompose`, `assign-next-unblocked` and dependency-aware
 * ranking, and its tables held zero rows five months later — locally and in the team
 * backend. The engine was not the missing part. Two things were:
 *
 *   A contributor was assumed to be a person (name, email, skills, bandwidth), so using it
 *   meant a person remembering to ask for an assignment. Nobody did.
 *
 *   `assignNext` partitioned by project, so work queued in one repository was unreachable
 *   from a session sitting in another — which is exactly the handoff being automated.
 *
 * Zero rows is why this could be redesigned rather than deprecated: there was no caller to
 * keep compatible with.
 */
describe('sessions as contributors', () => {
  let db: Database.Database;
  let svc: CoordinationService;
  const REPO = 'C:/work/api';

  const work = (project: string, title: string, role: DecomposeInput['packages'][number]['roleRequired'] = 'builder') =>
    svc.decomposeWork({
      project,
      packages: [{ title, description: `do ${title}`, roleRequired: role, dependsOn: [] }],
    });

  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(SCHEMA_SQL);
    svc = new CoordinationService(db);
  });

  describe('registerSession', () => {
    it('registers a session as a contributor', () => {
      const c = svc.registerSession({ project: 'api', repoPath: REPO, role: 'builder' });
      expect(c.kind).toBe('session');
      expect(c.repoPath).toBe(REPO);
      expect(c.role).toBe('builder');
    });

    it('is idempotent — a SessionStart hook fires on every session', () => {
      const first = svc.registerSession({ project: 'api', repoPath: REPO, role: 'builder' });
      const second = svc.registerSession({ project: 'api', repoPath: REPO, role: 'builder' });
      expect(second.id).toBe(first.id);
      expect(svc.listContributors('api')).toHaveLength(1);
    });

    it('keeps separate rows per role in the same repository', () => {
      svc.registerSession({ project: 'api', repoPath: REPO, role: 'builder' });
      svc.registerSession({ project: 'api', repoPath: REPO, role: 'verifier' });
      expect(svc.listContributors('api')).toHaveLength(2);
    });

    it('frees a session that ended while holding work', () => {
      // A session that is killed mid-task leaves its row `busy`, and a busy contributor is
      // never offered anything — the queue would read as empty while being full.
      work('api', 'first');
      const c = svc.registerSession({ project: 'api', repoPath: REPO, role: 'builder' });
      svc.assignNext({ contributorId: c.id });
      expect(svc.listContributors('api')[0]?.availability).toBe('busy');

      const again = svc.registerSession({ project: 'api', repoPath: REPO, role: 'builder' });
      expect(again.availability).toBe('available');
      expect(again.id).toBe(c.id);
    });

    it('leaves a person as a person', () => {
      const human = svc.addContributor({
        project: 'api', name: 'Ada', skills: ['ts'], role: 'builder',
      });
      expect(human.kind).toBe('human');
      expect(human.repoPath).toBeUndefined();
    });
  });

  describe('claiming work across projects', () => {
    it('claims work queued in another repository', () => {
      // The manual step being removed: queue work for the web repo, and let the session
      // sitting in it pick the work up without anyone relaying a prompt.
      work('web', 'ship the banner');
      const session = svc.registerSession({ project: 'api', repoPath: REPO, role: 'builder' });

      const claimed = svc.assignNext({ contributorId: session.id });
      expect(claimed).not.toBeNull();
      expect(claimed!.workPackage.project).toBe('web');
      expect(claimed!.contributor.id).toBe(session.id);
    });

    it('still narrows to one project when asked', () => {
      work('web', 'web thing');
      work('api', 'api thing');
      const session = svc.registerSession({ project: 'api', repoPath: REPO, role: 'builder' });

      const claimed = svc.assignNext({ project: 'api', contributorId: session.id });
      expect(claimed!.workPackage.project).toBe('api');
    });

    it('takes work for its own role by default', () => {
      work('api', 'verify it', 'verifier');
      const builder = svc.registerSession({ project: 'api', repoPath: REPO, role: 'builder' });
      expect(svc.assignNext({ contributorId: builder.id })).toBeNull();

      const verifier = svc.registerSession({ project: 'api', repoPath: REPO, role: 'verifier' });
      expect(svc.assignNext({ contributorId: verifier.id })!.workPackage.title).toBe('verify it');
    });

    it('returns null rather than throwing when nothing is waiting', () => {
      // The common case. A hook that errors on every quiet session start gets turned off.
      const session = svc.registerSession({ project: 'api', repoPath: REPO, role: 'builder' });
      expect(svc.assignNext({ contributorId: session.id })).toBeNull();
    });

    it('returns null for an unknown contributor instead of assigning to someone else', () => {
      work('api', 'something');
      expect(svc.assignNext({ contributorId: 'no-such-contributor' })).toBeNull();
      // And the package stays available for a real claimant.
      const session = svc.registerSession({ project: 'api', repoPath: REPO, role: 'builder' });
      expect(svc.assignNext({ contributorId: session.id })).not.toBeNull();
    });
  });

  describe('what did not change', () => {
    it('still assigns by availability when no claimant is named', () => {
      work('api', 'a task');
      const ada = svc.addContributor({ project: 'api', name: 'Ada', skills: [], role: 'builder' });
      const claimed = svc.assignNext({ project: 'api' });
      expect(claimed!.contributor.id).toBe(ada.id);
    });

    it('still respects dependencies', () => {
      const created = svc.decomposeWork({
        project: 'api',
        packages: [
          { title: 'schema', description: 'first', roleRequired: 'builder', dependsOn: [] },
          { title: 'endpoint', description: 'second', roleRequired: 'builder', dependsOn: ['schema'] },
        ],
      });
      expect(created).toHaveLength(2);

      const session = svc.registerSession({ project: 'api', repoPath: REPO, role: 'builder' });
      const claimed = svc.assignNext({ contributorId: session.id });
      // The blocked one must not be handed out first.
      expect(claimed!.workPackage.title).toBe('schema');
    });
  });
});
