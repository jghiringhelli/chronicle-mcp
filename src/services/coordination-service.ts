/**
 * CoordinationService — Axon layer on top of Chronicle.
 *
 * Manages contributors, work packages, and assignments for a multi-person
 * AI-assisted development team. Work packages are ranked by a reverse-topological
 * priority score: high-rank items unblock the most downstream work and should be
 * started first. This approximates the dominant eigenvector of the dependency
 * adjacency matrix without requiring a linear algebra library.
 *
 * Roles
 * ─────
 * specwright  Write and maintain GS artifacts (CLAUDE.md, use-cases, ADRs)
 * builder     Implement a fully specced work unit
 * merger      Integrate parallel branches, enforce architectural constraints
 * verifier    Run scoring, Hurl tests, mutation suite
 * watcher     Monitor coordination state, flag stalls (AI-only is fine)
 */

import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Database } from 'better-sqlite3';

// ─── Types ─────────────────────────────────────────────────────────────────

export type ContributorRole = 'specwright' | 'builder' | 'merger' | 'verifier' | 'watcher';
export type WorkStatus = 'pending' | 'active' | 'blocked' | 'complete';
export type AvailabilityState = 'available' | 'busy' | 'offline';

export interface Contributor {
  id: string;
  project: string;
  name: string;
  email?: string;
  skills: string[];
  role: ContributorRole;
  bandwidthHoursPerWeek: number;
  availability: AvailabilityState;
  lastActiveAt: string;
  createdAt: string;
}

export interface WorkPackage {
  id: string;
  project: string;
  title: string;
  description: string;
  specSection?: string;
  status: WorkStatus;
  roleRequired: ContributorRole;
  /** IDs of packages that must be complete before this one can start */
  dependencies: string[];
  /** Reverse-topological rank: count of packages transitively blocked behind this one */
  priorityRank: number;
  /** Parent milestone ID, if this package belongs to a milestone */
  parentId?: string;
  /** True if this package is a milestone (groups child packages) */
  isMilestone: boolean;
  /** Git branch name for this work package */
  branchName?: string;
  /** ForgeCraft verify results — set when merge is requested */
  forgecraftScore?: number;
  forgecraftTier?: number;
  forgecraftPass?: boolean;
  assignedTo?: string;
  assignedAt?: string;
  completedAt?: string;
  createdAt: string;
}

export interface MergeRequest {
  id: string;
  project: string;
  workPackageId: string;
  branchName: string;
  fromContributorId: string;
  forgecraftScore?: number;
  forgecraftTier?: number;
  forgecraftPass?: boolean;
  forgecraftReport?: string;
  approvedBy?: string;
  approvedAt?: string;
  rejectedBy?: string;
  rejectedAt?: string;
  rejectionReason?: string;
  status: 'pending' | 'approved' | 'rejected';
  createdAt: string;
}

export interface SpecSyncResult {
  projectDir: string;
  filesFound: string[];
  specContent: Record<string, string>;
  milestones: string[];
  todos: string[];
  summary: string;
}

export interface Assignment {
  id: string;
  workPackageId: string;
  contributorId: string;
  role: ContributorRole;
  assignedAt: string;
  completedAt?: string;
  status: 'active' | 'complete' | 'dropped';
}

export interface DecomposeInput {
  project: string;
  milestoneId?: string;
  packages: Array<{
    title: string;
    description: string;
    specSection?: string;
    roleRequired: ContributorRole;
    /** Titles of packages this one depends on */
    dependsOn?: string[];
  }>;
}

// ─── Service ───────────────────────────────────────────────────────────────

export class CoordinationService {
  constructor(private readonly db: Database) {}

  // ── Contributors ──────────────────────────────────────────────────────────

  addContributor(input: {
    project: string;
    name: string;
    email?: string;
    skills: string[];
    role: ContributorRole;
    bandwidthHoursPerWeek?: number;
  }): Contributor {
    const id = randomUUID();
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO contributors
        (id, project, name, email, skills, role, bandwidth_hours_per_week, availability, last_active_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'available', ?, ?)
    `).run(
      id, input.project, input.name, input.email ?? null,
      JSON.stringify(input.skills), input.role,
      input.bandwidthHoursPerWeek ?? 20, now, now,
    );
    return this.requireContributor(id);
  }

  updateAvailability(contributorId: string, availability: AvailabilityState): Contributor {
    const now = new Date().toISOString();
    this.db.prepare(
      `UPDATE contributors SET availability = ?, last_active_at = ? WHERE id = ?`,
    ).run(availability, now, contributorId);
    return this.requireContributor(contributorId);
  }

  listContributors(project: string): Contributor[] {
    const rows = this.db.prepare(
      `SELECT * FROM contributors WHERE project = ? ORDER BY last_active_at DESC`,
    ).all(project) as any[];
    return rows.map(r => this.rowToContributor(r));
  }

  // ── Work decomposition ────────────────────────────────────────────────────

  /**
   * Decompose a body of work into ranked independent packages.
   *
   * Priority rank is computed via reverse-topological scoring:
   *   rank[i] = number of nodes that transitively depend on node i
   *
   * This gives the same ordering as the dominant eigenvector of the
   * transitive closure of the dependency adjacency matrix — high-rank
   * items are critical path blockers and should be started first.
   *
   * Packages whose dependencies are not all complete are inserted as
   * 'blocked'; those with no unmet dependencies are 'pending'.
   */
  decomposeWork(input: DecomposeInput): WorkPackage[] {
    const now = new Date().toISOString();

    // Assign IDs and build title → id map
    const ids = input.packages.map(() => randomUUID());
    const titleToId = new Map<string, string>();
    input.packages.forEach((p, i) => titleToId.set(p.title, ids[i]!));

    // Resolve dependency titles to IDs
    const resolved = input.packages.map((p, i) => ({
      id: ids[i]!,
      title: p.title,
      description: p.description,
      specSection: p.specSection,
      roleRequired: p.roleRequired,
      dependencyIds: (p.dependsOn ?? []).map(t => titleToId.get(t) ?? t),
    }));

    // Compute priority ranks
    const ranks = this.computePriorityRanks(
      resolved.map(p => ({ id: p.id, dependencyIds: p.dependencyIds })),
    );

    // Insert — packages with dependencies start as 'blocked'
    const stmt = this.db.prepare(`
      INSERT INTO work_packages
        (id, project, title, description, spec_section, status, role_required, dependencies, priority_rank, parent_id, is_milestone, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
    `);
    for (const p of resolved) {
      const status: WorkStatus = p.dependencyIds.length > 0 ? 'blocked' : 'pending';
      stmt.run(
        p.id, input.project, p.title, p.description,
        p.specSection ?? null, status, p.roleRequired,
        JSON.stringify(p.dependencyIds), ranks.get(p.id) ?? 0,
        input.milestoneId ?? null, now,
      );
    }

    return this.getQueue(input.project);
  }

  /**
   * Reverse-topological priority scoring.
   *
   * For each node, BFS over the reverse-dependency graph (who depends on me?)
   * and count all transitive dependents. Nodes with more transitive dependents
   * have higher rank and should be started first.
   */
  private computePriorityRanks(
    nodes: Array<{ id: string; dependencyIds: string[] }>,
  ): Map<string, number> {
    // Build reverse adjacency: id → set of ids that directly depend on it
    const dependents = new Map<string, Set<string>>();
    for (const n of nodes) {
      if (!dependents.has(n.id)) dependents.set(n.id, new Set());
      for (const dep of n.dependencyIds) {
        if (!dependents.has(dep)) dependents.set(dep, new Set());
        dependents.get(dep)!.add(n.id);
      }
    }

    // BFS from each node counting transitive dependents
    const ranks = new Map<string, number>();
    for (const n of nodes) {
      const visited = new Set<string>();
      const queue = [...(dependents.get(n.id) ?? [])];
      while (queue.length > 0) {
        const cur = queue.shift()!;
        if (visited.has(cur)) continue;
        visited.add(cur);
        for (const d of dependents.get(cur) ?? []) queue.push(d);
      }
      ranks.set(n.id, visited.size);
    }
    return ranks;
  }

  // ── Assignment ────────────────────────────────────────────────────────────

  /**
   * Assign the highest-priority unblocked work package to the most available
   * contributor. If contributorId is given, assigns to that person specifically.
   * Returns null when no work is available or no matching contributor is free.
   *
   * Also generates and records the required git branch name for this work.
   * Branch convention: feature/<contributor-slug>/<package-slug>
   * Mergers use: merge/<package-slug>
   * Specwrights use: spec/<package-slug>
   */
  assignNext(input: {
    project: string;
    contributorId?: string;
    roleFilter?: ContributorRole;
  }): { workPackage: WorkPackage; contributor: Contributor; requiredBranch: string } | null {
    const candidate = this.getNextUnblocked(input.project, input.roleFilter);
    if (!candidate) return null;

    const contributor = input.contributorId
      ? this.getContributor(input.contributorId)
      : this.getMostAvailable(input.project, candidate.roleRequired);
    if (!contributor) return null;

    const now = new Date().toISOString();

    // Generate required branch name
    const prefix = candidate.roleRequired === 'merger' ? 'merge'
      : candidate.roleRequired === 'specwright' ? 'spec'
      : 'feature';
    const contributorSlug = this.toSlug(contributor.name);
    const packageSlug = this.toSlug(candidate.title);
    const requiredBranch = prefix === 'feature'
      ? `feature/${contributorSlug}/${packageSlug}`
      : `${prefix}/${packageSlug}`;

    this.db.prepare(`
      INSERT INTO assignments (id, work_package_id, contributor_id, role, assigned_at, status)
      VALUES (?, ?, ?, ?, ?, 'active')
    `).run(randomUUID(), candidate.id, contributor.id, candidate.roleRequired, now);

    this.db.prepare(
      `UPDATE work_packages SET status = 'active', assigned_to = ?, assigned_at = ?, branch_name = ? WHERE id = ?`,
    ).run(contributor.id, now, requiredBranch, candidate.id);

    this.db.prepare(
      `UPDATE contributors SET availability = 'busy', last_active_at = ? WHERE id = ?`,
    ).run(now, contributor.id);

    return {
      workPackage: this.requireWorkPackage(candidate.id),
      contributor: this.requireContributor(contributor.id),
      requiredBranch,
    };
  }

  /**
   * Mark a work package complete. Frees the contributor and promotes any
   * downstream packages whose dependencies are now all satisfied.
   */
  completeWork(workPackageId: string): {
    completed: WorkPackage;
    newlyUnblocked: WorkPackage[];
    milestonesCompleted: WorkPackage[];
  } {
    const wp = this.requireWorkPackage(workPackageId);
    const now = new Date().toISOString();

    this.db.prepare(
      `UPDATE work_packages SET status = 'complete', completed_at = ? WHERE id = ?`,
    ).run(now, workPackageId);

    this.db.prepare(
      `UPDATE assignments SET status = 'complete', completed_at = ? WHERE work_package_id = ? AND status = 'active'`,
    ).run(now, workPackageId);

    if (wp.assignedTo) {
      this.db.prepare(
        `UPDATE contributors SET availability = 'available', last_active_at = ? WHERE id = ?`,
      ).run(now, wp.assignedTo);
    }

    const newlyUnblocked = this.promoteUnblocked(wp.project);
    const milestonesCompleted = this.evaluateMilestones(wp.project);

    return {
      completed: this.requireWorkPackage(workPackageId),
      newlyUnblocked,
      milestonesCompleted,
    };
  }

  /**
   * Scan all blocked packages. Promote to 'pending' any whose dependencies
   * are now all complete.
   */
  private promoteUnblocked(project: string): WorkPackage[] {
    const blocked = this.db.prepare(
      `SELECT * FROM work_packages WHERE project = ? AND status = 'blocked'`,
    ).all(project) as any[];

    const promoted: WorkPackage[] = [];
    for (const row of blocked) {
      const deps: string[] = JSON.parse(row.dependencies ?? '[]');
      const allDone = deps.every(depId => {
        const dep = this.db.prepare(
          `SELECT status FROM work_packages WHERE id = ?`,
        ).get(depId) as any;
        return dep?.status === 'complete';
      });
      if (allDone) {
        this.db.prepare(`UPDATE work_packages SET status = 'pending' WHERE id = ?`).run(row.id);
        promoted.push(this.requireWorkPackage(row.id));
      }
    }
    return promoted;
  }

  // ── Spec sync ─────────────────────────────────────────────────────────────

  /**
   * Scan a project directory for GS spec files and return their content
   * structured for AI-driven decomposition. Does not auto-create work packages —
   * the AI reads this output and calls decompose() with the derived package list.
   *
   * Scans: CLAUDE.md, use-cases.md, milestones.md, TODO.md, docs/adrs/, STATUS.md
   */
  syncSpec(projectDir: string): SpecSyncResult {
    const specFiles = [
      'CLAUDE.md', 'use-cases.md', 'milestones.md', 'TODO.md',
      'STATUS.md', 'README.md',
    ];
    const filesFound: string[] = [];
    const specContent: Record<string, string> = {};

    for (const f of specFiles) {
      const p = join(projectDir, f);
      if (existsSync(p)) {
        filesFound.push(f);
        specContent[f] = readFileSync(p, 'utf-8');
      }
    }

    // Scan ADR directory
    const adrDir = join(projectDir, 'docs', 'adrs');
    if (existsSync(adrDir)) {
      try {
        const adrs = readdirSync(adrDir).filter(f => f.endsWith('.md'));
        for (const adr of adrs.slice(0, 20)) {
          const key = `docs/adrs/${adr}`;
          filesFound.push(key);
          specContent[key] = readFileSync(join(adrDir, adr), 'utf-8');
        }
      } catch { /* non-fatal */ }
    }

    // Extract milestone headings from milestones.md or TODO.md
    const milestones: string[] = [];
    const todos: string[] = [];
    for (const [, content] of Object.entries(specContent)) {
      for (const line of content.split('\n')) {
        if (/^#+\s+milestone/i.test(line) || /^#+\s+v\d/i.test(line)) {
          milestones.push(line.replace(/^#+\s*/, '').trim());
        }
        if (/^[-*]\s+\[[ x]\]/.test(line)) {
          todos.push(line.replace(/^[-*]\s+\[[ x]\]\s*/, '').trim());
        }
      }
    }

    const summary = [
      `${filesFound.length} spec file(s) found: ${filesFound.join(', ')}`,
      milestones.length > 0 ? `${milestones.length} milestone(s) detected` : '',
      todos.length > 0 ? `${todos.length} TODO item(s) detected` : '',
    ].filter(Boolean).join(' · ');

    return { projectDir, filesFound, specContent, milestones, todos, summary };
  }

  // ── Milestones ────────────────────────────────────────────────────────────

  /**
   * Create a milestone — a named parent that groups child work packages.
   * Milestones complete automatically when all children complete.
   */
  addMilestone(input: {
    project: string;
    title: string;
    description: string;
    specSection?: string;
  }): WorkPackage {
    const id = randomUUID();
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO work_packages
        (id, project, title, description, spec_section, status, role_required, dependencies, priority_rank, is_milestone, created_at)
      VALUES (?, ?, ?, ?, ?, 'pending', 'merger', '[]', 0, 1, ?)
    `).run(id, input.project, input.title, input.description, input.specSection ?? null, now);
    return this.requireWorkPackage(id);
  }

  /**
   * Check if a milestone's children are all complete and mark it done if so.
   * Called automatically after completeWork().
   */
  evaluateMilestones(project: string): WorkPackage[] {
    const milestones = this.db.prepare(
      `SELECT * FROM work_packages WHERE project = ? AND is_milestone = 1 AND status != 'complete'`,
    ).all(project) as any[];

    const completed: WorkPackage[] = [];
    for (const m of milestones) {
      const children = this.db.prepare(
        `SELECT status FROM work_packages WHERE project = ? AND parent_id = ?`,
      ).all(project, m.id) as any[];
      if (children.length > 0 && children.every((c: any) => c.status === 'complete')) {
        const now = new Date().toISOString();
        this.db.prepare(
          `UPDATE work_packages SET status = 'complete', completed_at = ? WHERE id = ?`,
        ).run(now, m.id);
        completed.push(this.requireWorkPackage(m.id));
      }
    }
    return completed;
  }

  // ── Merge requests ────────────────────────────────────────────────────────

  /**
   * Submit a merge request for a completed work package. Records the ForgeCraft
   * verify result (caller must run verify and pass the score/tier/pass values).
   * Only a contributor with role 'merger' can approve.
   *
   * If forgecraftPass is false, the MR is created but flagged as failing the gate.
   * The merger can still override with an explicit rejection reason recorded.
   */
  requestMerge(input: {
    workPackageId: string;
    branchName: string;
    fromContributorId: string;
    forgecraftScore?: number;
    forgecraftTier?: number;
    forgecraftPass?: boolean;
    forgecraftReport?: string;
  }): MergeRequest {
    const wp = this.requireWorkPackage(input.workPackageId);
    const id = randomUUID();
    const now = new Date().toISOString();

    // Record ForgeCraft results on the work package
    this.db.prepare(`
      UPDATE work_packages
      SET forgecraft_score = ?, forgecraft_tier = ?, forgecraft_pass = ?
      WHERE id = ?
    `).run(
      input.forgecraftScore ?? null,
      input.forgecraftTier ?? null,
      input.forgecraftPass != null ? (input.forgecraftPass ? 1 : 0) : null,
      input.workPackageId,
    );

    this.db.prepare(`
      INSERT INTO merge_requests
        (id, project, work_package_id, branch_name, from_contributor_id,
         forgecraft_score, forgecraft_tier, forgecraft_pass, forgecraft_report, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
    `).run(
      id, wp.project, input.workPackageId, input.branchName, input.fromContributorId,
      input.forgecraftScore ?? null, input.forgecraftTier ?? null,
      input.forgecraftPass != null ? (input.forgecraftPass ? 1 : 0) : null,
      input.forgecraftReport ?? null, now,
    );

    return this.requireMergeRequest(id);
  }

  /**
   * Approve or reject a merge request. Only contributors with role 'merger' may approve.
   * On approval, the work package is marked complete and the contributor is freed.
   */
  resolveMerge(input: {
    mergeRequestId: string;
    reviewerId: string;
    approve: boolean;
    rejectionReason?: string;
  }): { mergeRequest: MergeRequest; milestonesCompleted: WorkPackage[] } {
    const mr = this.requireMergeRequest(input.mergeRequestId);
    const reviewer = this.requireContributor(input.reviewerId);
    if (reviewer.role !== 'merger') {
      throw new Error(`Only contributors with role 'merger' can resolve merge requests. ${reviewer.name} has role '${reviewer.role}'.`);
    }

    const now = new Date().toISOString();

    if (input.approve) {
      this.db.prepare(`
        UPDATE merge_requests SET status = 'approved', approved_by = ?, approved_at = ? WHERE id = ?
      `).run(input.reviewerId, now, input.mergeRequestId);

      // Complete the work package
      this.db.prepare(
        `UPDATE work_packages SET status = 'complete', completed_at = ? WHERE id = ?`,
      ).run(now, mr.workPackageId);

      // Close active assignment
      this.db.prepare(
        `UPDATE assignments SET status = 'complete', completed_at = ? WHERE work_package_id = ? AND status = 'active'`,
      ).run(now, mr.workPackageId);

      // Free the contributor who did the work
      const wp = this.requireWorkPackage(mr.workPackageId);
      if (wp.assignedTo) {
        this.db.prepare(
          `UPDATE contributors SET availability = 'available', last_active_at = ? WHERE id = ?`,
        ).run(now, wp.assignedTo);
      }

      // Unblock downstream packages
      this.promoteUnblocked(mr.project);

      // Evaluate milestones
      const milestonesCompleted = this.evaluateMilestones(mr.project);

      return { mergeRequest: this.requireMergeRequest(input.mergeRequestId), milestonesCompleted };
    } else {
      this.db.prepare(`
        UPDATE merge_requests
        SET status = 'rejected', rejected_by = ?, rejected_at = ?, rejection_reason = ?
        WHERE id = ?
      `).run(input.reviewerId, now, input.rejectionReason ?? null, input.mergeRequestId);

      // Put work package back to active (contributor must revise)
      this.db.prepare(
        `UPDATE work_packages SET status = 'active' WHERE id = ?`,
      ).run(mr.workPackageId);

      return { mergeRequest: this.requireMergeRequest(input.mergeRequestId), milestonesCompleted: [] };
    }
  }

  listMergeRequests(project: string, status?: 'pending' | 'approved' | 'rejected'): MergeRequest[] {
    const rows = status
      ? this.db.prepare(
          `SELECT * FROM merge_requests WHERE project = ? AND status = ? ORDER BY created_at DESC`,
        ).all(project, status) as any[]
      : this.db.prepare(
          `SELECT * FROM merge_requests WHERE project = ? ORDER BY created_at DESC`,
        ).all(project) as any[];
    return rows.map(r => this.rowToMergeRequest(r));
  }

  // ── Status & queue ────────────────────────────────────────────────────────

  /**
   * Full team status — suitable for dashboard rendering.
   */
  getStatus(project: string): {
    contributors: Array<Contributor & { currentWork?: WorkPackage }>;
    queue: WorkPackage[];
    summary: { total: number; pending: number; active: number; blocked: number; complete: number };
  } {
    const contributors = this.listContributors(project).map(c => {
      const row = this.db.prepare(
        `SELECT * FROM work_packages WHERE project = ? AND assigned_to = ? AND status = 'active' LIMIT 1`,
      ).get(project, c.id) as any;
      return { ...c, currentWork: row ? this.rowToWorkPackage(row) : undefined };
    });

    const queue = this.getQueue(project);

    const countRows = this.db.prepare(
      `SELECT status, COUNT(*) as n FROM work_packages WHERE project = ? GROUP BY status`,
    ).all(project) as any[];
    const summary = { total: 0, pending: 0, active: 0, blocked: 0, complete: 0 };
    for (const row of countRows) {
      const key = row.status as keyof typeof summary;
      if (key in summary) summary[key] = row.n;
      summary.total += row.n;
    }

    return { contributors, queue, summary };
  }

  /**
   * Work queue for a project — all non-complete packages, ranked by priority.
   */
  getQueue(project: string): WorkPackage[] {
    const rows = this.db.prepare(
      `SELECT * FROM work_packages WHERE project = ? AND status != 'complete'
       ORDER BY priority_rank DESC, created_at ASC`,
    ).all(project) as any[];
    return rows.map(r => this.rowToWorkPackage(r));
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private getNextUnblocked(project: string, role?: ContributorRole): WorkPackage | undefined {
    const row = role
      ? this.db.prepare(
          `SELECT * FROM work_packages WHERE project = ? AND status = 'pending' AND role_required = ?
           ORDER BY priority_rank DESC LIMIT 1`,
        ).get(project, role) as any
      : this.db.prepare(
          `SELECT * FROM work_packages WHERE project = ? AND status = 'pending'
           ORDER BY priority_rank DESC LIMIT 1`,
        ).get(project) as any;
    return row ? this.rowToWorkPackage(row) : undefined;
  }

  private getMostAvailable(project: string, role: ContributorRole): Contributor | undefined {
    const row = this.db.prepare(`
      SELECT * FROM contributors
      WHERE project = ? AND role = ? AND availability = 'available'
      ORDER BY bandwidth_hours_per_week DESC, last_active_at ASC
      LIMIT 1
    `).get(project, role) as any;
    return row ? this.rowToContributor(row) : undefined;
  }

  private getContributor(id: string): Contributor | undefined {
    const row = this.db.prepare(`SELECT * FROM contributors WHERE id = ?`).get(id) as any;
    return row ? this.rowToContributor(row) : undefined;
  }

  private requireContributor(id: string): Contributor {
    const c = this.getContributor(id);
    if (!c) throw new Error(`Contributor not found: ${id}`);
    return c;
  }

  private requireWorkPackage(id: string): WorkPackage {
    const row = this.db.prepare(`SELECT * FROM work_packages WHERE id = ?`).get(id) as any;
    if (!row) throw new Error(`Work package not found: ${id}`);
    return this.rowToWorkPackage(row);
  }

  private rowToContributor(row: any): Contributor {
    return {
      id: row.id,
      project: row.project,
      name: row.name,
      email: row.email ?? undefined,
      skills: JSON.parse(row.skills ?? '[]'),
      role: row.role as ContributorRole,
      bandwidthHoursPerWeek: row.bandwidth_hours_per_week,
      availability: row.availability as AvailabilityState,
      lastActiveAt: row.last_active_at,
      createdAt: row.created_at,
    };
  }

  private rowToWorkPackage(row: any): WorkPackage {
    return {
      id: row.id,
      project: row.project,
      title: row.title,
      description: row.description,
      specSection: row.spec_section ?? undefined,
      status: row.status as WorkStatus,
      roleRequired: row.role_required as ContributorRole,
      dependencies: JSON.parse(row.dependencies ?? '[]'),
      priorityRank: row.priority_rank,
      parentId: row.parent_id ?? undefined,
      isMilestone: row.is_milestone === 1,
      branchName: row.branch_name ?? undefined,
      forgecraftScore: row.forgecraft_score ?? undefined,
      forgecraftTier: row.forgecraft_tier ?? undefined,
      forgecraftPass: row.forgecraft_pass != null ? row.forgecraft_pass === 1 : undefined,
      assignedTo: row.assigned_to ?? undefined,
      assignedAt: row.assigned_at ?? undefined,
      completedAt: row.completed_at ?? undefined,
      createdAt: row.created_at,
    };
  }

  private requireMergeRequest(id: string): MergeRequest {
    const row = this.db.prepare(`SELECT * FROM merge_requests WHERE id = ?`).get(id) as any;
    if (!row) throw new Error(`Merge request not found: ${id}`);
    return this.rowToMergeRequest(row);
  }

  private rowToMergeRequest(row: any): MergeRequest {
    return {
      id: row.id,
      project: row.project,
      workPackageId: row.work_package_id,
      branchName: row.branch_name,
      fromContributorId: row.from_contributor_id,
      forgecraftScore: row.forgecraft_score ?? undefined,
      forgecraftTier: row.forgecraft_tier ?? undefined,
      forgecraftPass: row.forgecraft_pass != null ? row.forgecraft_pass === 1 : undefined,
      forgecraftReport: row.forgecraft_report ?? undefined,
      approvedBy: row.approved_by ?? undefined,
      approvedAt: row.approved_at ?? undefined,
      rejectedBy: row.rejected_by ?? undefined,
      rejectedAt: row.rejected_at ?? undefined,
      rejectionReason: row.rejection_reason ?? undefined,
      status: row.status as MergeRequest['status'],
      createdAt: row.created_at,
    };
  }

  /** Convert a name to a URL-safe slug for branch naming. */
  private toSlug(text: string): string {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40);
  }
}
