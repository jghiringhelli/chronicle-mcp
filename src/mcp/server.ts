/**
 * Chronicle MCP server — wires services and registers all tools.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getDatabase } from '../infrastructure/db/database.js';
import {
  SqliteMemoryRepository,
  SqliteSessionRepository,
  SqlitePreferenceRepository,
  SqliteTeamRepository,
} from '../adapters/repositories/index.js';
import { MemoryService } from '../services/memory-service.js';
import { SessionService } from '../services/session-service.js';
import { TriggerService } from '../services/trigger-service.js';
import { PreferenceService } from '../services/preference-service.js';
import { TeamService } from '../services/team-service.js';
import { PromptLogService } from '../services/prompt-log-service.js';
import { TeamSyncService } from '../services/team-sync-service.js';
import { PatternService } from '../services/pattern-service.js';
import { NodeIdGenerator } from '../infrastructure/gateways/node-id-generator.js';
import { NodeClock } from '../infrastructure/gateways/node-clock.js';
import type { MemoryType } from '../domain/types.js';
import { REINFORCEMENT_BOOSTS } from '../domain/types.js';
import { registerTeamTools } from './team-tools.js';

/** Wire up all services and register MCP tools. */
export function createMcpServer(): McpServer {
  const db = getDatabase();
  const idGen = new NodeIdGenerator();
  const clock = new NodeClock();
  const memRepo = new SqliteMemoryRepository(db);
  const sessRepo = new SqliteSessionRepository(db);
  const prefRepo = new SqlitePreferenceRepository(db);
  const teamRepo = new SqliteTeamRepository(db);
  const memSvc = new MemoryService(memRepo, idGen, clock);
  const sessSvc = new SessionService(sessRepo, idGen, clock);
  const trigSvc = new TriggerService(db);
  const prefSvc = new PreferenceService(prefRepo, idGen);
  const teamSvc = new TeamService();
  const promptLogSvc = new PromptLogService(teamRepo, idGen);
  const teamSyncSvc = new TeamSyncService(teamRepo, promptLogSvc);
  const patternSvc = new PatternService(teamRepo);

  const server = new McpServer({ name: 'chronicle', version: '0.1.0' });

  // ── chronicle ─────────────────────────────────────────────────────────────
  // Covers: memory CRUD, triggers, preferences, stats, decay.

  server.tool(
    'chronicle',
    'Manage memories, triggers and preferences.',
    {
      action: z.enum([
        'remember', 'recall', 'forget',
        'trigger', 'check',
        'pref', 'prefs',
        'stats', 'decay',
      ]).describe(
        'remember=store | recall=search | forget=delete | ' +
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
      memory_type:  z.enum(['episodic', 'semantic', 'procedural', 'architectural', 'insight']).optional()
                      .describe('episodic=happened | semantic=is-true | procedural=how-to | architectural=why | insight=pattern'),
      tags:         z.array(z.string()).optional(),
      confirmed:    z.boolean().optional().describe('Permanent truth — zero decay, Core tier'),
      // recall / prefs
      query:        z.string().optional(),
      memory_types: z.array(z.enum(['episodic', 'semantic', 'procedural', 'architectural', 'insight'])).optional(),
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
    'Manage Chronicle sessions.',
    {
      action:  z.enum(['start', 'end', 'recover']).describe('start | end | recover'),
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
          teamSyncSvc.sync().catch(() => undefined);
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

  registerTeamTools(server, teamSvc, promptLogSvc, teamSyncSvc, patternSvc, teamRepo, memRepo);

  return server;
}
