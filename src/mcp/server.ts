/**
 * Chronicle MCP server — wires services and registers all tools.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getDatabase } from '../infrastructure/db/database.js';
import { getConfig } from '../shared/config/index.js';
import { TEAM_SCHEMA_SQL } from '../infrastructure/db/team-schema.js';
import {
  SqliteMemoryRepository,
  SqliteSessionRepository,
  SqlitePreferenceRepository,
} from '../adapters/repositories/index.js';
import { MemoryService } from '../services/memory-service.js';
import { SessionService } from '../services/session-service.js';
import { TriggerService } from '../services/trigger-service.js';
import { PreferenceService } from '../services/preference-service.js';
import { CoordinationService } from '../services/coordination-service.js';
import type { ContributorRole } from '../services/coordination-service.js';
import { syncCoordination } from '../services/sync.js';
import { NodeIdGenerator } from '../infrastructure/gateways/node-id-generator.js';
import { NodeClock } from '../infrastructure/gateways/node-clock.js';
import type { MemoryType } from '../domain/types.js';
import { REINFORCEMENT_BOOSTS } from '../domain/types.js';

// Cache token validation for process lifetime — one Railway round-trip max.
let _tokenValid: boolean | null = null;

async function validateTeamToken(token: string, railwayUrl: string | undefined, teamId: string): Promise<boolean> {
  if (_tokenValid !== null) return _tokenValid;
  if (!railwayUrl) { _tokenValid = true; return true; } // local-only mode — trust presence
  try {
    const { default: postgres } = await import('postgres');
    const sql = postgres(railwayUrl, { ssl: 'require', max: 1 });
    await sql.unsafe(TEAM_SCHEMA_SQL);
    const rows = await sql<{ token: string }[]>`
      SELECT token FROM team_licenses
      WHERE token = ${token} AND team_id = ${teamId}
        AND revoked = FALSE
        AND (expires_at IS NULL OR expires_at > NOW())
    `;
    await sql.end();
    _tokenValid = rows.length > 0;
  } catch {
    _tokenValid = true; // Railway down — fail open so offline work is not blocked
  }
  return _tokenValid;
}

/** Wire up all services and register MCP tools. */
export function createMcpServer(): McpServer {
  const db = getDatabase();
  const idGen = new NodeIdGenerator();
  const clock = new NodeClock();
  const memRepo = new SqliteMemoryRepository(db);
  const sessRepo = new SqliteSessionRepository(db);
  const prefRepo = new SqlitePreferenceRepository(db);
  const memSvc = new MemoryService(memRepo, idGen, clock);
  const sessSvc = new SessionService(sessRepo, idGen, clock);
  const trigSvc = new TriggerService(db);
  const prefSvc = new PreferenceService(prefRepo, idGen);
  const coordSvc = new CoordinationService(db);

  const server = new McpServer({ name: 'chronicle', version: '0.3.1' });

  // ── chronicle ─────────────────────────────────────────────────────────────
  // Covers: memory CRUD, triggers, preferences, stats, decay.

  server.tool(
    'chronicle',
    [
      'Persistent memory across Claude Code sessions.',
      '',
      'RECALL at the start of any substantive block — a new domain conversation, a decision point, returning to a topic from a prior session. Recall is cheap (~1s) and the value is high: prior context informs current work instead of being re-derived. Skipping recall means losing inherited context.',
      '',
      'REMEMBER after any architectural decision — technology choices, pricing decisions, customer-facing positioning, infrastructure setup, methodology pivots, anything you would want the NEXT session to inherit without re-deriving. The cost is ~1s; the value compounds across every future session that touches the same domain.',
      '',
      'Six memory types: episodic (it happened), semantic (it is true), procedural (how-to), architectural (why), insight (pattern), coordination (team-state). Set confirmed=true for decisions that should never decay (Core tier).',
      '',
      'Tag with project + descriptive keywords so future recall finds the memory. Use stats periodically to confirm the system is healthy; use decay sparingly (it runs automatically on session end).',
    ].join('\n'),
    {
      action: z.enum([
        'remember', 'recall', 'forget',
        'trigger', 'check',
        'pref', 'prefs',
        'stats', 'decay',
      ]).describe(
        'remember=store-decision | recall=load-prior-context | forget=delete | ' +
        'trigger=set-guard | check=fire-triggers | ' +
        'pref=set-preference | prefs=get-preferences | ' +
        'stats=summary | decay=run-decay',
      ),
      // Shared
      id:           z.string().optional().describe('Memory or trigger ID'),
      project:      z.string().optional(),
      category:     z.string().optional(),
      // remember
      content:      z.string().optional(),
      memory_type:  z.enum(['episodic', 'semantic', 'procedural', 'architectural', 'insight', 'coordination']).optional()
                      .describe('episodic=happened | semantic=is-true | procedural=how-to | architectural=why | insight=pattern | coordination=team-state'),
      tags:         z.array(z.string()).optional(),
      confirmed:    z.boolean().optional().describe('Permanent truth — zero decay, Core tier'),
      // recall / prefs
      query:        z.string().optional(),
      memory_types: z.array(z.enum(['episodic', 'semantic', 'procedural', 'architectural', 'insight', 'coordination'])).optional(),
      tiers:        z.array(z.enum(['buffer', 'working', 'core'])).optional(),
      limit:        z.number().optional(),
      context:      z.string().optional(),
      // trigger
      trigger_action: z.string().optional().describe('Action keyword for trigger/check ops (e.g. "deploy")'),
      severity:       z.enum(['critical', 'warning', 'info']).optional(),
      // pref
      pref_key:   z.string().optional(),
      pref_value: z.string().optional(),
      strength:   z.enum(['strong', 'moderate', 'weak']).optional(),
    },
    (args) => {
      switch (args.action) {

        case 'remember': {
          const memory = memSvc.remember({
            content: args.content ?? '',
            memoryType: (args.memory_type ?? 'semantic') as MemoryType,
            project: args.project,
            category: args.category,
            tags: args.tags,
            confirmed: args.confirmed,
          });
          return { content: [{ type: 'text', text: JSON.stringify({ id: memory.id, tier: memory.tier, weight: memory.weight }) }] };
        }

        case 'recall': {
          const memories = memSvc.recall({
            query: args.query ?? '',
            project: args.project,
            category: args.category,
            memoryTypes: args.memory_types as MemoryType[] | undefined,
            tiers: args.tiers,
            limit: args.limit,
          });
          for (const m of memories) {
            try { memSvc.reinforce(m.id, 'RECALL_HIT'); } catch { /* non-fatal */ }
          }
          return {
            content: [{ type: 'text', text: JSON.stringify(memories.map(m => ({
              id: m.id, content: m.content, memoryType: m.memoryType,
              tier: m.tier, weight: m.weight, project: m.project,
              category: m.category, tags: m.tags,
            }))) }],
          };
        }

        case 'forget': {
          memSvc.forget(args.id ?? '', args.context);
          return { content: [{ type: 'text', text: JSON.stringify({ message: 'Deleted.' }) }] };
        }

        case 'trigger': {
          const id = trigSvc.setTrigger({
            action: args.trigger_action ?? '',
            content: args.content ?? '',
            severity: args.severity,
            memoryId: args.id,
          });
          return { content: [{ type: 'text', text: JSON.stringify({ id, message: 'Trigger set.' }) }] };
        }

        case 'check': {
          const triggers = trigSvc.checkTriggers(args.trigger_action ?? '', args.project);
          for (const t of triggers) {
            if (t.memoryId) {
              try { memSvc.reinforce(t.memoryId, 'TRIGGER_HIT'); } catch { /* non-fatal */ }
            }
          }
          return { content: [{ type: 'text', text: JSON.stringify(triggers) }] };
        }

        case 'pref': {
          prefSvc.setPreference(args.pref_key ?? '', args.pref_value ?? '', args.context, args.strength, args.project);
          return { content: [{ type: 'text', text: JSON.stringify({ message: 'Preference set.' }) }] };
        }

        case 'prefs': {
          const prefs = args.context
            ? prefSvc.getRelevantPreferences(args.context, args.project)
            : prefSvc.getPreferences(args.project);
          return {
            content: [{ type: 'text', text: JSON.stringify(prefs.map(p => ({
              key: p.key, value: p.value, context: p.context, strength: p.strength, project: p.project,
            }))) }],
          };
        }

        case 'stats': {
          const total   = memRepo.count(args.project ? { project: args.project } : undefined);
          const buffer  = memRepo.count({ tier: 'buffer',  ...(args.project ? { project: args.project } : {}) });
          const working = memRepo.count({ tier: 'working', ...(args.project ? { project: args.project } : {}) });
          const core    = memRepo.count({ tier: 'core',    ...(args.project ? { project: args.project } : {}) });
          return {
            content: [{ type: 'text', text: JSON.stringify({ total, byTier: { buffer, working, core }, project: args.project, boosts: REINFORCEMENT_BOOSTS }) }],
          };
        }

        case 'decay': {
          const decayed  = memSvc.applyDecay();
          const promoted = memSvc.evaluateTierPromotions();
          return { content: [{ type: 'text', text: JSON.stringify({ memoriesDecayed: decayed, memoriesPromoted: promoted }) }] };
        }

        default:
          return { content: [{ type: 'text', text: JSON.stringify({ error: `Unknown action: ${args.action}` }) }] };
      }
    },
  );

  // ── session ───────────────────────────────────────────────────────────────
  // Covers: start, end, recover.

  server.tool(
    'session',
    [
      'Manage Chronicle session boundaries.',
      '',
      'Call session START at the beginning of substantive multi-turn work — this automatically injects the project\'s core memories (confirmed=true entries) into context, so the session begins with prior knowledge instead of an empty slate.',
      '',
      'Call session END at session close — applies memory decay + tier promotions, keeps the memory store from sprawling, and persists any session summary you pass.',
      '',
      'Call session RECOVER to resume an active session by ID or project name — useful when work was interrupted.',
    ].join('\n'),
    {
      action:  z.enum(['start', 'end', 'recover']).describe('start=load-core-memories | end=decay-and-promote | recover=resume-interrupted-session'),
      project: z.string().optional(),
      device:  z.string().optional(),
      id:      z.string().optional(),
      summary: z.string().optional(),
    },
    (args) => {
      switch (args.action) {

        case 'start': {
          const sess = sessSvc.startSession(args.project ?? '', args.device);
          const coreMemories = memSvc.recall({ query: args.project ?? '', project: args.project, tiers: ['core'], limit: 10 });
          for (const m of coreMemories) {
            try { memSvc.reinforce(m.id, 'CONTEXT_INJECT'); } catch { /* non-fatal */ }
          }
          return {
            content: [{ type: 'text', text: JSON.stringify({
              id: sess.id, project: sess.project, status: sess.status, startedAt: sess.startedAt,
              coreMemories: coreMemories.map(m => ({ id: m.id, content: m.content, memoryType: m.memoryType })),
            }) }],
          };
        }

        case 'end': {
          const sess     = sessSvc.endSession(args.id ?? '', args.summary);
          const decayed  = memSvc.applyDecay();
          const promoted = memSvc.evaluateTierPromotions();
          return {
            content: [{ type: 'text', text: JSON.stringify({
              id: sess.id, status: sess.status, endedAt: sess.endedAt,
              maintenance: { memoriesDecayed: decayed, memoriesPromoted: promoted },
            }) }],
          };
        }

        case 'recover': {
          const sess = args.id
            ? sessSvc.recoverSession(args.id)
            : args.project ? sessSvc.getActiveSession(args.project) : null;
          return {
            content: [{ type: 'text', text: JSON.stringify(sess ? {
              id: sess.id, project: sess.project, status: sess.status, startedAt: sess.startedAt,
              activeTasks: sess.activeTasks, pendingDecisions: sess.pendingDecisions,
              touchedFiles: sess.touchedFiles, summary: sess.summary,
            } : { message: 'No session found.' }) }],
          };
        }

        default:
          return { content: [{ type: 'text', text: JSON.stringify({ error: `Unknown action: ${args.action}` }) }] };
      }
    },
  );

  // ── axon ──────────────────────────────────────────────────────────────────
  // Team coordination: contributors, work decomposition, assignment, status.

  server.tool(
    'axon',
    'Coordinate a development team — register contributors, decompose specs into ranked work packages, assign tasks, track progress.',
    {
      action: z.enum([
        'contributor_add',
        'spec_sync',
        'milestone_add',
        'decompose',
        'assign',
        'complete',
        'request_merge',
        'resolve_merge',
        'merges',
        'status',
        'queue',
      ]).describe(
        'contributor_add=register-dev | spec_sync=read-spec-files | milestone_add=create-milestone | ' +
        'decompose=break-spec-into-ranked-packages | assign=assign-next-unblocked-package | ' +
        'complete=mark-work-locally-done | request_merge=submit-for-merger-review | ' +
        'resolve_merge=approve-or-reject-merge | merges=list-merge-requests | ' +
        'status=full-team-dashboard | queue=ranked-work-queue',
      ),
      project: z.string().optional().describe('Project identifier'),

      // contributor_add
      name:         z.string().optional().describe('Contributor full name'),
      email:        z.string().optional(),
      skills:       z.array(z.string()).optional().describe('Skill tags, e.g. ["typescript","testing"]'),
      role:         z.enum(['specwright', 'builder', 'merger', 'verifier', 'watcher']).optional()
                      .describe('specwright=spec/ADR | builder=implement | merger=integrate | verifier=test/score | watcher=monitor'),
      bandwidth:    z.number().optional().describe('Available hours per week'),

      // decompose — AI provides the breakdown, Axon ranks and persists it
      packages: z.array(z.object({
        title:        z.string().describe('Short unique title'),
        description:  z.string().describe('What needs to be done'),
        spec_section: z.string().optional().describe('Spec or ADR reference'),
        role_required: z.enum(['specwright', 'builder', 'merger', 'verifier', 'watcher']),
        depends_on:   z.array(z.string()).optional().describe('Titles of packages this must wait for'),
      })).optional().describe('Work packages to decompose — AI derives these from spec+state gap'),

      // spec_sync
      project_dir: z.string().optional().describe('Absolute path to repo root for spec_sync'),

      // milestone_add
      milestone_title:        z.string().optional(),
      milestone_description:  z.string().optional(),
      milestone_spec_section: z.string().optional(),

      // decompose
      milestone_id: z.string().optional().describe('Parent milestone ID to attach packages to'),

      // assign / complete / availability
      id:              z.string().optional().describe('Work package ID, merge request ID, or contributor ID'),
      contributor_id:  z.string().optional().describe('Force-assign to this contributor'),
      role_filter:     z.enum(['specwright', 'builder', 'merger', 'verifier', 'watcher']).optional()
                         .describe('Only consider packages requiring this role'),
      availability:    z.enum(['available', 'busy', 'offline']).optional()
                         .describe('Update contributor availability state'),

      // request_merge
      branch_name:       z.string().optional().describe('Git branch name'),
      forgecraft_score:  z.number().optional().describe('ForgeCraft verify totalScore (0–14)'),
      forgecraft_tier:   z.number().optional().describe('ForgeCraft GS maturity tier (1–5)'),
      forgecraft_pass:   z.boolean().optional().describe('Whether ForgeCraft verify passed'),
      forgecraft_report: z.string().optional().describe('Full ForgeCraft verify report text'),

      // resolve_merge
      approve:          z.boolean().optional().describe('true=approve, false=reject'),
      rejection_reason: z.string().optional(),

      // merges filter
      merge_status: z.enum(['pending', 'approved', 'rejected']).optional(),
    },
    async (args) => {
      const config = getConfig();
      if (!config.teamToken) {
        return { content: [{ type: 'text', text: JSON.stringify({
          error: 'Axon requires a Chronicle Team license. Add teamToken to ~/.chronicle/config.json. Generate one with: chronicle-mcp generate-token --team <slug>',
        }) }] };
      }
      if (!config.teamId) {
        return { content: [{ type: 'text', text: JSON.stringify({
          error: 'Axon requires teamId in ~/.chronicle/config.json.',
        }) }] };
      }
      const tokenOk = await validateTeamToken(config.teamToken, config.railwayUrl, config.teamId);
      if (!tokenOk) {
        return { content: [{ type: 'text', text: JSON.stringify({
          error: 'Invalid or revoked teamToken. Generate a new one with: chronicle-mcp generate-token --team <slug>',
        }) }] };
      }

      const project = args.project ?? 'default';

      // Pull latest team state from Railway before any read or write.
      // Fire-and-forget on write actions — response is not blocked.
      const isRead = args.action === 'status' || args.action === 'queue' || args.action === 'merges';
      if (isRead) {
        await syncCoordination(project).catch(() => { /* offline — use local cache */ });
      }

      switch (args.action) {

        case 'contributor_add': {
          const contributor = coordSvc.addContributor({
            project,
            name: args.name ?? 'Unknown',
            email: args.email,
            skills: args.skills ?? [],
            role: (args.role ?? 'builder') as ContributorRole,
            bandwidthHoursPerWeek: args.bandwidth ?? 20,
          });
          syncCoordination(project).catch(() => {});
          return { content: [{ type: 'text', text: JSON.stringify(contributor) }] };
        }

        case 'spec_sync': {
          if (!args.project_dir) {
            return { content: [{ type: 'text', text: JSON.stringify({ error: 'project_dir required for spec_sync' }) }] };
          }
          const sync = coordSvc.syncSpec(args.project_dir);
          return { content: [{ type: 'text', text: JSON.stringify(sync) }] };
        }

        case 'milestone_add': {
          if (!args.milestone_title) {
            return { content: [{ type: 'text', text: JSON.stringify({ error: 'milestone_title required' }) }] };
          }
          const milestone = coordSvc.addMilestone({
            project,
            title: args.milestone_title,
            description: args.milestone_description ?? '',
            specSection: args.milestone_spec_section,
          });
          return { content: [{ type: 'text', text: JSON.stringify(milestone) }] };
        }

        case 'decompose': {
          if (!args.packages?.length) {
            return { content: [{ type: 'text', text: JSON.stringify({ error: 'packages[] required for decompose' }) }] };
          }
          const queue = coordSvc.decomposeWork({
            project,
            milestoneId: args.milestone_id,
            packages: args.packages.map(p => ({
              title: p.title,
              description: p.description,
              specSection: p.spec_section,
              roleRequired: p.role_required as ContributorRole,
              dependsOn: p.depends_on,
            })),
          });
          syncCoordination(project).catch(() => {});
          return { content: [{ type: 'text', text: JSON.stringify(queue) }] };
        }

        case 'assign': {
          const result = coordSvc.assignNext({
            project,
            contributorId: args.contributor_id,
            roleFilter: args.role_filter as ContributorRole | undefined,
          });
          if (!result) {
            return { content: [{ type: 'text', text: JSON.stringify({ message: 'No unblocked work available or no matching contributor free.' }) }] };
          }
          syncCoordination(project).catch(() => {});
          return { content: [{ type: 'text', text: JSON.stringify(result) }] };
        }

        case 'complete': {
          if (!args.id) {
            return { content: [{ type: 'text', text: JSON.stringify({ error: 'id (work package ID) required' }) }] };
          }
          const result = coordSvc.completeWork(args.id);
          syncCoordination(project).catch(() => {});
          return { content: [{ type: 'text', text: JSON.stringify(result) }] };
        }

        case 'request_merge': {
          if (!args.id || !args.branch_name || !args.contributor_id) {
            return { content: [{ type: 'text', text: JSON.stringify({ error: 'id (work_package_id), branch_name, and contributor_id required' }) }] };
          }
          const mr = coordSvc.requestMerge({
            workPackageId: args.id,
            branchName: args.branch_name,
            fromContributorId: args.contributor_id,
            forgecraftScore: args.forgecraft_score,
            forgecraftTier: args.forgecraft_tier,
            forgecraftPass: args.forgecraft_pass,
            forgecraftReport: args.forgecraft_report,
          });
          syncCoordination(project).catch(() => {});
          return { content: [{ type: 'text', text: JSON.stringify(mr) }] };
        }

        case 'resolve_merge': {
          if (!args.id || !args.contributor_id || args.approve == null) {
            return { content: [{ type: 'text', text: JSON.stringify({ error: 'id (merge_request_id), contributor_id, and approve (bool) required' }) }] };
          }
          const result = coordSvc.resolveMerge({
            mergeRequestId: args.id,
            reviewerId: args.contributor_id,
            approve: args.approve,
            rejectionReason: args.rejection_reason,
          });
          syncCoordination(project).catch(() => {});
          return { content: [{ type: 'text', text: JSON.stringify(result) }] };
        }

        case 'merges': {
          const mrs = coordSvc.listMergeRequests(
            project,
            args.merge_status as 'pending' | 'approved' | 'rejected' | undefined,
          );
          return { content: [{ type: 'text', text: JSON.stringify(mrs) }] };
        }

        case 'status': {
          const status = coordSvc.getStatus(project);
          return { content: [{ type: 'text', text: JSON.stringify(status) }] };
        }

        case 'queue': {
          const queue = coordSvc.getQueue(project);
          return { content: [{ type: 'text', text: JSON.stringify(queue) }] };
        }

        default:
          return { content: [{ type: 'text', text: JSON.stringify({ error: `Unknown action: ${args.action}` }) }] };
      }
    },
  );

  return server;
}
