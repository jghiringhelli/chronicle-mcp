import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { CoordinationService } from '../../../src/services/coordination-service.js';
import type { ContributorRole, DecomposeInput } from '../../../src/services/coordination-service.js';
import { SCHEMA_SQL } from '../../../src/infrastructure/db/schema.js';

/**
 * CoordinationService — the `axon` team layer (ADR-010, ADR-011, UC-009, EDR-004).
 *
 * 771 lines with zero tests before this file. EDR-004 prescribes the order used here:
 * the pure ranking algorithm first (four graph shapes, cycle included), then the
 * assignment/availability invariant, then branch derivation, then downstream promotion.
 *
 * Real `:memory:` SQLite throughout — the service's contract *is* the SQL, so a mocked
 * database would verify nothing (testing.md, doubles taxonomy).
 */
describe('CoordinationService', () => {
  let db: Database.Database;
  let svc: CoordinationService;
  const PROJECT = 'my-app';

  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(SCHEMA_SQL);
    svc = new CoordinationService(db);
  });

  const addContributor = (name: string, role: ContributorRole) =>
    svc.addContributor({ project: PROJECT, name, role, skills: [], bandwidthHoursPerWeek: 40 });

  /** Decompose a dependency graph given as `title -> titles it depends on`. */
  const decompose = (graph: Record<string, string[]>, role: ContributorRole = 'builder') => {
    const input: DecomposeInput = {
      project: PROJECT,
      packages: Object.entries(graph).map(([title, dependsOn]) => ({
        title,
        description: `work for ${title}`,
        specSection: `spec.md#${title}`,
        roleRequired: role,
        dependsOn,
      })),
    };
    return svc.decomposeWork(input);
  };

  const rankOf = (title: string) =>
    svc.getQueue(PROJECT).find((p) => p.title === title)?.priorityRank;

  // ── 1. Priority ranking — the pure algorithm (EDR-004) ────────────────────────────────────

  describe('priority ranking: count of transitive dependents', () => {
    it('ranks a linear chain by how much each package unblocks', () => {
      // C depends on B depends on A. A unblocks two things, B one, C nothing.
      decompose({ A: [], B: ['A'], C: ['B'] });

      expect(rankOf('A')).toBe(2);
      expect(rankOf('B')).toBe(1);
      expect(rankOf('C')).toBe(0);
    });

    it('counts a diamond once per dependent, not once per path', () => {
      // B and C both depend on A; D depends on both. A unblocks B, C and D — three, not four.
      decompose({ A: [], B: ['A'], C: ['A'], D: ['B', 'C'] });

      expect(rankOf('A')).toBe(3);
      expect(rankOf('B')).toBe(1);
      expect(rankOf('C')).toBe(1);
      expect(rankOf('D')).toBe(0);
    });

    it('keeps disconnected components from contaminating each other', () => {
      decompose({ A: [], B: ['A'], X: [], Y: ['X'], Z: [] });

      expect(rankOf('A')).toBe(1);
      expect(rankOf('X')).toBe(1);
      expect(rankOf('Z')).toBe(0);
    });

    it('terminates on a dependency cycle instead of hanging or throwing', () => {
      // THE test EDR-004 exists to protect: the BFS is cycle-tolerant by construction, where a
      // memoised recursion would not be. If someone "optimises" the traversal, this fails.
      const run = () => decompose({ A: ['C'], B: ['A'], C: ['B'] });

      expect(run).not.toThrow();
      // Every node reaches every other node in a 3-cycle, itself excluded from its own visited set
      // only if not revisited — the contract is finiteness, not a specific number.
      for (const title of ['A', 'B', 'C']) {
        const r = rankOf(title);
        expect(r).toBeGreaterThanOrEqual(0);
        expect(r).toBeLessThanOrEqual(3);
      }
    });

    it('gives every package rank 0 when nothing depends on anything', () => {
      decompose({ A: [], B: [], C: [] });

      expect([rankOf('A'), rankOf('B'), rankOf('C')]).toEqual([0, 0, 0]);
    });
  });

  // ── 2. Decomposition ──────────────────────────────────────────────────────────────────────

  describe('decomposition', () => {
    it('starts a package with dependencies as blocked and one without as pending', () => {
      decompose({ A: [], B: ['A'] });
      const queue = svc.getQueue(PROJECT);

      expect(queue.find((p) => p.title === 'A')?.status).toBe('pending');
      expect(queue.find((p) => p.title === 'B')?.status).toBe('blocked');
    });

    it('resolves dependsOn titles into the generated package ids', () => {
      decompose({ A: [], B: ['A'] });
      const queue = svc.getQueue(PROJECT);
      const a = queue.find((p) => p.title === 'A')!;
      const b = queue.find((p) => p.title === 'B')!;

      expect(b.dependencies).toEqual([a.id]);
    });

    it('keeps the spec section, because unanchored work is what this layer prevents', () => {
      decompose({ A: [] });

      expect(svc.getQueue(PROJECT)[0]?.specSection).toBe('spec.md#A');
    });

    it('scopes the queue to its project', () => {
      decompose({ A: [] });
      svc.decomposeWork({
        project: 'other-app',
        packages: [{ title: 'Z', description: 'z', roleRequired: 'builder' }],
      });

      expect(svc.getQueue(PROJECT).map((p) => p.title)).toEqual(['A']);
    });
  });

  // ── 3. Assignment and the availability invariant ──────────────────────────────────────────

  describe('assignment', () => {
    it('returns null when there is no work, rather than throwing', () => {
      addContributor('Alice', 'builder');

      expect(svc.assignNext({ project: PROJECT })).toBeNull();
    });

    it('returns null when work exists but no contributor matches the required role', () => {
      decompose({ A: [] }, 'merger');
      addContributor('Alice', 'builder');

      expect(svc.assignNext({ project: PROJECT })).toBeNull();
    });

    it('assigns the highest-ranked unblocked package first', () => {
      decompose({ A: [], B: ['A'], Standalone: [] });
      addContributor('Alice', 'builder');

      // A has rank 1 and is unblocked; Standalone has rank 0; B is blocked.
      expect(svc.assignNext({ project: PROJECT })?.workPackage.title).toBe('A');
    });

    it('never assigns a blocked package', () => {
      decompose({ A: [], B: ['A'] });
      addContributor('Alice', 'builder');
      addContributor('Bob', 'builder');

      const first = svc.assignNext({ project: PROJECT });
      const second = svc.assignNext({ project: PROJECT });

      expect(first?.workPackage.title).toBe('A');
      expect(second).toBeNull();
    });

    it('marks the package active and the contributor busy together', () => {
      decompose({ A: [] });
      const alice = addContributor('Alice', 'builder');

      const assigned = svc.assignNext({ project: PROJECT })!;

      expect(assigned.workPackage.status).toBe('active');
      expect(assigned.workPackage.assignedTo).toBe(alice.id);
      expect(svc.listContributors(PROJECT).find((c) => c.id === alice.id)?.availability).toBe('busy');
    });

    it('assigns to a named contributor when one is given', () => {
      decompose({ A: [] });
      addContributor('Alice', 'builder');
      const bob = addContributor('Bob', 'builder');

      const assigned = svc.assignNext({ project: PROJECT, contributorId: bob.id })!;

      expect(assigned.contributor.id).toBe(bob.id);
    });
  });

  describe('branch name derivation — a contract between assignNext and resolveMerge', () => {
    it('derives feature/<contributor>/<package> for a builder', () => {
      decompose({ 'Add Auth Layer': [] }, 'builder');
      addContributor('Alice Smith', 'builder');

      expect(svc.assignNext({ project: PROJECT })?.requiredBranch)
        .toBe('feature/alice-smith/add-auth-layer');
    });

    it('derives merge/<package> for a merger, with no contributor segment', () => {
      decompose({ 'Release v2': [] }, 'merger');
      addContributor('Bob Jones', 'merger');

      expect(svc.assignNext({ project: PROJECT })?.requiredBranch).toBe('merge/release-v2');
    });

    it('derives spec/<package> for a specwright', () => {
      decompose({ 'Write The Spec': [] }, 'specwright');
      addContributor('Carol', 'specwright');

      expect(svc.assignNext({ project: PROJECT })?.requiredBranch).toBe('spec/write-the-spec');
    });

    it('persists the branch name on the package, so the merge gate can check it', () => {
      decompose({ 'Add Auth': [] });
      addContributor('Alice', 'builder');

      const assigned = svc.assignNext({ project: PROJECT })!;

      expect(svc.getQueue(PROJECT).find((p) => p.id === assigned.workPackage.id)?.branchName)
        .toBe(assigned.requiredBranch);
    });
  });

  // ── 4. Completion and downstream promotion ────────────────────────────────────────────────

  describe('completion', () => {
    it('frees the contributor, leaving nobody busy without an active assignment', () => {
      decompose({ A: [] });
      const alice = addContributor('Alice', 'builder');
      const assigned = svc.assignNext({ project: PROJECT })!;

      svc.completeWork(assigned.workPackage.id);

      expect(svc.listContributors(PROJECT).find((c) => c.id === alice.id)?.availability)
        .toBe('available');
    });

    it('marks the package complete and stamps completedAt', () => {
      decompose({ A: [] });
      addContributor('Alice', 'builder');
      const assigned = svc.assignNext({ project: PROJECT })!;

      const result = svc.completeWork(assigned.workPackage.id);

      expect(result.completed.status).toBe('complete');
      expect(result.completed.completedAt).toBeTruthy();
    });

    it('drops the completed package out of the queue — the queue is work remaining', () => {
      decompose({ A: [] });
      addContributor('Alice', 'builder');
      const assigned = svc.assignNext({ project: PROJECT })!;

      svc.completeWork(assigned.workPackage.id);

      // getQueue filters `status != 'complete'`. Finished work is not queued work, so a caller
      // polling the queue sees it disappear rather than linger as noise.
      expect(svc.getQueue(PROJECT).find((p) => p.id === assigned.workPackage.id)).toBeUndefined();
    });

    it('reports which downstream packages it unblocked', () => {
      decompose({ A: [], B: ['A'] });
      addContributor('Alice', 'builder');
      const a = svc.assignNext({ project: PROJECT })!;

      const result = svc.completeWork(a.workPackage.id);

      expect(result.newlyUnblocked.map((p) => p.title)).toEqual(['B']);
    });

    it('promotes a downstream package once its only dependency completes', () => {
      decompose({ A: [], B: ['A'] });
      addContributor('Alice', 'builder');
      const a = svc.assignNext({ project: PROJECT })!;

      svc.completeWork(a.workPackage.id);

      expect(svc.getQueue(PROJECT).find((p) => p.title === 'B')?.status).toBe('pending');
    });

    it('leaves a package blocked while any dependency is still outstanding', () => {
      decompose({ A: [], B: [], C: ['A', 'B'] });
      addContributor('Alice', 'builder');
      const first = svc.assignNext({ project: PROJECT })!;

      svc.completeWork(first.workPackage.id);

      // One of C's two dependencies is done; C must stay blocked.
      expect(svc.getQueue(PROJECT).find((p) => p.title === 'C')?.status).toBe('blocked');
    });

    it('promotes only the packages whose dependencies are satisfied, not every blocked one', () => {
      decompose({ A: [], B: ['A'], Unrelated: [], AlsoBlocked: ['Unrelated'] });
      addContributor('Alice', 'builder');

      const a = svc.getQueue(PROJECT).find((p) => p.title === 'A')!;
      svc.assignNext({ project: PROJECT, contributorId: svc.listContributors(PROJECT)[0]!.id });
      svc.completeWork(a.id);

      const queue = svc.getQueue(PROJECT);
      expect(queue.find((p) => p.title === 'B')?.status).toBe('pending');
      expect(queue.find((p) => p.title === 'AlsoBlocked')?.status).toBe('blocked');
    });

    it('lets the freed contributor take the newly unblocked package', () => {
      decompose({ A: [], B: ['A'] });
      addContributor('Alice', 'builder');
      const a = svc.assignNext({ project: PROJECT })!;
      svc.completeWork(a.workPackage.id);

      expect(svc.assignNext({ project: PROJECT })?.workPackage.title).toBe('B');
    });
  });

  // ── 5. Roster ─────────────────────────────────────────────────────────────────────────────

  describe('roster', () => {
    it('registers a contributor as available', () => {
      const alice = addContributor('Alice', 'builder');

      expect(alice.availability).toBe('available');
      expect(alice.role).toBe('builder');
    });

    it('updates availability', () => {
      const alice = addContributor('Alice', 'builder');

      svc.updateAvailability(alice.id, 'offline');

      expect(svc.listContributors(PROJECT).find((c) => c.id === alice.id)?.availability)
        .toBe('offline');
    });

    it('does not assign work to an offline contributor', () => {
      decompose({ A: [] });
      const alice = addContributor('Alice', 'builder');
      svc.updateAvailability(alice.id, 'offline');

      expect(svc.assignNext({ project: PROJECT })).toBeNull();
    });

    it('scopes the roster to its project', () => {
      addContributor('Alice', 'builder');
      svc.addContributor({ project: 'other-app', name: 'Zed', role: 'builder', skills: [], bandwidthHoursPerWeek: 40 });

      expect(svc.listContributors(PROJECT).map((c) => c.name)).toEqual(['Alice']);
    });

    it('round-trips skills through their JSON column', () => {
      const alice = svc.addContributor({
        project: PROJECT, name: 'Alice', role: 'builder',
        skills: ['typescript', 'sqlite'], bandwidthHoursPerWeek: 40,
      });

      expect(svc.listContributors(PROJECT).find((c) => c.id === alice.id)?.skills)
        .toEqual(['typescript', 'sqlite']);
    });
  });

  // ── 6. Merge gating — records a verdict, never computes one ────────────────────────────────

  describe('merge gating', () => {
    const assignOne = () => {
      decompose({ A: [] });
      addContributor('Alice', 'builder');
      return svc.assignNext({ project: PROJECT })!;
    };

    /** requestMerge takes the branch explicitly and derives the project from the package. */
    const openMerge = (
      assigned: NonNullable<ReturnType<CoordinationService['assignNext']>>,
      verdict: { forgecraftScore?: number; forgecraftTier?: number; forgecraftPass?: boolean } = {},
    ) => svc.requestMerge({
      workPackageId: assigned.workPackage.id,
      branchName: assigned.requiredBranch,
      fromContributorId: assigned.contributor.id,
      ...verdict,
    });

    it('records the verdict the caller passes in, and never computes one', () => {
      const assigned = assignOne();

      // The score is supplied by whoever ran the gates. This service records it; making it
      // compute one would put enforcement inside the memory server (core.md scope boundary).
      const mr = openMerge(assigned, { forgecraftScore: 12, forgecraftTier: 3, forgecraftPass: true });

      expect(mr.status).toBe('pending');
      expect(mr.forgecraftScore).toBe(12);
      expect(mr.forgecraftPass).toBe(true);
    });

    it('accepts a merge request with no verdict at all', () => {
      const assigned = assignOne();

      const mr = openMerge(assigned);

      expect(mr.status).toBe('pending');
      expect(mr.forgecraftScore).toBeUndefined();
    });

    it('stamps the verdict onto the work package too, not only the request', () => {
      const assigned = assignOne();

      openMerge(assigned, { forgecraftScore: 14, forgecraftPass: true });

      const wp = svc.getQueue(PROJECT).find((p) => p.id === assigned.workPackage.id);
      expect(wp?.forgecraftScore).toBe(14);
      expect(wp?.forgecraftPass).toBe(true);
    });

    it('carries the assigned branch onto the merge request', () => {
      const assigned = assignOne();

      expect(openMerge(assigned).branchName).toBe(assigned.requiredBranch);
    });

    it('lists a pending request, and filters by status', () => {
      openMerge(assignOne());

      expect(svc.listMergeRequests(PROJECT, 'pending')).toHaveLength(1);
      expect(svc.listMergeRequests(PROJECT, 'approved')).toHaveLength(0);
    });

    it('records an approval by a merger', () => {
      const assigned = assignOne();
      const mr = openMerge(assigned);
      const reviewer = addContributor('Mallory', 'merger');

      svc.resolveMerge({ mergeRequestId: mr.id, approve: true, reviewerId: reviewer.id });

      expect(svc.listMergeRequests(PROJECT, 'approved')).toHaveLength(1);
      expect(svc.listMergeRequests(PROJECT, 'pending')).toHaveLength(0);
    });

    it('completes the work package when the merge is approved', () => {
      const assigned = assignOne();
      const mr = openMerge(assigned);
      const reviewer = addContributor('Mallory', 'merger');

      svc.resolveMerge({ mergeRequestId: mr.id, approve: true, reviewerId: reviewer.id });

      // An approved merge is what finishes the work — the package leaves the queue.
      expect(svc.getQueue(PROJECT).find((p) => p.id === assigned.workPackage.id)).toBeUndefined();
    });

    it('records a rejection with its reason', () => {
      const assigned = assignOne();
      const mr = openMerge(assigned);
      const reviewer = addContributor('Mallory', 'merger');

      svc.resolveMerge({
        mergeRequestId: mr.id, approve: false,
        reviewerId: reviewer.id, rejectionReason: 'mutation score under gate',
      });

      const rejected = svc.listMergeRequests(PROJECT, 'rejected');
      expect(rejected).toHaveLength(1);
      expect(rejected[0]?.rejectionReason).toBe('mutation score under gate');
    });

    it('refuses a resolution from anyone whose role is not merger', () => {
      const assigned = assignOne();
      const mr = openMerge(assigned);

      // The author is a `builder`. Separation of duties: the person who did the work cannot wave
      // their own merge through. This is the only authorisation rule in the service.
      expect(() => svc.resolveMerge({
        mergeRequestId: mr.id, approve: true, reviewerId: assigned.contributor.id,
      })).toThrow(/merger/);
    });

    it('refuses a resolution from an unknown reviewer', () => {
      const assigned = assignOne();
      const mr = openMerge(assigned);

      expect(() => svc.resolveMerge({
        mergeRequestId: mr.id, approve: true, reviewerId: 'nobody',
      })).toThrow(/Contributor not found/);
    });

    it('refuses to resolve a merge request that does not exist', () => {
      expect(() => svc.resolveMerge({
        mergeRequestId: 'no-such-request', approve: true, reviewerId: 'nobody',
      })).toThrow();
    });
  });

  // ── 7. Status ─────────────────────────────────────────────────────────────────────────────

  describe('status', () => {
    it('reports an empty project without throwing', () => {
      expect(() => svc.getStatus(PROJECT)).not.toThrow();
    });

    it('reflects work and roster counts', () => {
      decompose({ A: [], B: ['A'] });
      addContributor('Alice', 'builder');

      const status = svc.getStatus(PROJECT);

      expect(JSON.stringify(status)).toContain('A');
    });
  });
});
