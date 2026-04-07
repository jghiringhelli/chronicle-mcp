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
} from '../adapters/repositories/index.js';
import { MemoryService } from '../services/memory-service.js';
import { SessionService } from '../services/session-service.js';
import { TriggerService } from '../services/trigger-service.js';
import { PreferenceService } from '../services/preference-service.js';
import { NodeIdGenerator } from '../infrastructure/gateways/node-id-generator.js';
import { NodeClock } from '../infrastructure/gateways/node-clock.js';
import type { MemoryType } from '../domain/types.js';
import { REINFORCEMENT_BOOSTS } from '../domain/types.js';

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

  const server = new McpServer({ name: 'chronicle', version: '0.1.0' });

  // ── remember ──────────────────────────────────────────────────────────────

  server.tool(
    'remember',
    [
      'Store a memory in Chronicle. Choose memory_type carefully:',
      '  episodic      — something that HAPPENED (event, bug, decision made). Decays in ~7 days.',
      '  semantic      — something that IS TRUE about the codebase or environment right now. Decays in ~35 days. Add confirmed:true to make permanent.',
      '  procedural    — HOW to do something (commands, steps, workflow). Never decays. Starts in Core.',
      '  architectural — WHY it was built this way (ADR, tradeoff, rejected alternative). Never decays. Starts in Core.',
      '  insight       — a pattern ABOUT the developer or team (habit, bias, style). Never decays. Starts in Core. Prefer distill for bulk synthesis.',
      'Use confirmed:true for facts the user explicitly asserts as permanent truth — overrides decay to 0 and promotes to Core immediately.',
    ].join('\n'),
    {
      content: z.string().describe('Memory content'),
      memory_type: z.enum(['episodic', 'semantic', 'procedural', 'architectural', 'insight'])
        .describe('episodic=happened | semantic=is-true | procedural=how-to | architectural=why-built-this-way | insight=pattern-about-developer'),
      project: z.string().optional().describe('Project scope. Omit for cross-project memories.'),
      category: z.string().optional().describe('Optional grouping (e.g. "auth", "deploy", "performance")'),
      tags: z.array(z.string()).optional(),
      confirmed: z.boolean().optional().describe('true = user explicitly asserts this is permanently true. Overrides decay to 0, promotes to Core.'),
      source: z.string().optional(),
    },
    (args) => {
      const memory = memSvc.remember({
        content: args.content,
        memoryType: args.memory_type as MemoryType,
        project: args.project,
        category: args.category,
        tags: args.tags,
        confirmed: args.confirmed,
        source: args.source,
      });
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ id: memory.id, tier: memory.tier, weight: memory.weight, message: 'Memory stored.' }),
        }],
      };
    },
  );

  // ── recall ────────────────────────────────────────────────────────────────

  server.tool(
    'recall',
    'Search memories in Chronicle',
    {
      query: z.string().describe('Search query'),
      project: z.string().optional(),
      category: z.string().optional(),
      memory_types: z.array(z.enum(['episodic', 'semantic', 'procedural', 'architectural', 'insight'])).optional(),
      tiers: z.array(z.enum(['buffer', 'working', 'core'])).optional(),
      limit: z.number().optional(),
    },
    (args) => {
      const memories = memSvc.recall({
        query: args.query,
        project: args.project,
        category: args.category,
        memoryTypes: args.memory_types as MemoryType[] | undefined,
        tiers: args.tiers,
        limit: args.limit,
      });
      // Reinforce recalled memories
      for (const memory of memories) {
        try {
          memSvc.reinforce(memory.id, 'RECALL_HIT');
        } catch {
          // Non-fatal
        }
      }
      return {
        content: [{
          type: 'text',
          text: JSON.stringify(memories.map(m => ({
            id: m.id,
            content: m.content,
            memoryType: m.memoryType,
            tier: m.tier,
            weight: m.weight,
            project: m.project,
            category: m.category,
            tags: m.tags,
          }))),
        }],
      };
    },
  );

  // ── forget ────────────────────────────────────────────────────────────────

  server.tool(
    'forget',
    'Delete a memory from Chronicle',
    {
      id: z.string(),
      reason: z.string().optional(),
    },
    (args) => {
      memSvc.forget(args.id, args.reason);
      return { content: [{ type: 'text', text: JSON.stringify({ message: 'Memory deleted.' }) }] };
    },
  );

  // ── session_start ─────────────────────────────────────────────────────────

  server.tool(
    'session_start',
    'Start a new Chronicle session',
    {
      project: z.string(),
      device: z.string().optional(),
    },
    (args) => {
      const session = sessSvc.startSession(args.project, args.device);

      // Inject core memories for context
      const coreMemories = memSvc.recall({
        query: args.project,
        project: args.project,
        tiers: ['core'],
        limit: 10,
      });
      for (const m of coreMemories) {
        try {
          memSvc.reinforce(m.id, 'CONTEXT_INJECT');
        } catch {
          // Non-fatal
        }
      }

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            id: session.id,
            project: session.project,
            status: session.status,
            startedAt: session.startedAt,
            coreMemories: coreMemories.map(m => ({ id: m.id, content: m.content, memoryType: m.memoryType })),
          }),
        }],
      };
    },
  );

  // ── session_end ───────────────────────────────────────────────────────────

  server.tool(
    'session_end',
    'End a Chronicle session',
    {
      id: z.string(),
      summary: z.string().optional(),
    },
    (args) => {
      const session = sessSvc.endSession(args.id, args.summary);
      const decayed = memSvc.applyDecay();
      const promoted = memSvc.evaluateTierPromotions();
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            id: session.id,
            status: session.status,
            endedAt: session.endedAt,
            maintenance: { memoriesDecayed: decayed, memoriesPromoted: promoted },
          }),
        }],
      };
    },
  );

  // ── session_recover ───────────────────────────────────────────────────────

  server.tool(
    'session_recover',
    'Recover a previous Chronicle session',
    {
      id: z.string().optional(),
      project: z.string().optional(),
    },
    (args) => {
      let session = null;
      if (args.id) {
        session = sessSvc.recoverSession(args.id);
      } else if (args.project) {
        session = sessSvc.getActiveSession(args.project);
      }
      return {
        content: [{
          type: 'text',
          text: JSON.stringify(session ? {
            id: session.id,
            project: session.project,
            status: session.status,
            startedAt: session.startedAt,
            activeTasks: session.activeTasks,
            pendingDecisions: session.pendingDecisions,
            touchedFiles: session.touchedFiles,
            summary: session.summary,
          } : { message: 'No session found.' }),
        }],
      };
    },
  );

  // ── trigger_set ───────────────────────────────────────────────────────────

  server.tool(
    'set_trigger',
    'Set an action trigger',
    {
      action: z.string(),
      content: z.string(),
      severity: z.enum(['critical', 'warning', 'info']).optional(),
      memory_id: z.string().optional(),
    },
    (args) => {
      const id = trigSvc.setTrigger({
        action: args.action,
        content: args.content,
        severity: args.severity,
        memoryId: args.memory_id,
      });
      return { content: [{ type: 'text', text: JSON.stringify({ id, message: 'Trigger set.' }) }] };
    },
  );

  // ── trigger_check ─────────────────────────────────────────────────────────

  server.tool(
    'check_triggers',
    'Check triggers for an action',
    {
      action: z.string(),
      project: z.string().optional(),
    },
    (args) => {
      const triggers = trigSvc.checkTriggers(args.action, args.project);
      // Reinforce memories associated with triggered triggers
      for (const t of triggers) {
        if (t.memoryId) {
          try {
            memSvc.reinforce(t.memoryId, 'TRIGGER_HIT');
          } catch {
            // Non-fatal
          }
        }
      }
      return { content: [{ type: 'text', text: JSON.stringify(triggers) }] };
    },
  );

  // ── trigger_remove ────────────────────────────────────────────────────────

  server.tool(
    'trigger_remove',
    'Remove (deactivate) a trigger',
    { id: z.string() },
    (args) => {
      trigSvc.removeTrigger(args.id);
      return { content: [{ type: 'text', text: JSON.stringify({ message: 'Trigger removed.' }) }] };
    },
  );

  // ── set_preference ───────────────────────────────────────────────────────

  server.tool(
    'set_preference',
    'Set a developer preference',
    {
      key: z.string(),
      value: z.string(),
      context: z.string().optional(),
      strength: z.enum(['strong', 'moderate', 'weak']).optional(),
      project: z.string().optional(),
    },
    (args) => {
      prefSvc.setPreference(args.key, args.value, args.context, args.strength, args.project);
      return { content: [{ type: 'text', text: JSON.stringify({ message: 'Preference set.' }) }] };
    },
  );

  // ── get_preferences ───────────────────────────────────────────────────────

  server.tool(
    'get_preferences',
    'Get developer preferences',
    {
      project: z.string().optional(),
      context: z.string().optional(),
    },
    (args) => {
      const prefs = args.context
        ? prefSvc.getRelevantPreferences(args.context, args.project)
        : prefSvc.getPreferences(args.project);
      return {
        content: [{
          type: 'text',
          text: JSON.stringify(prefs.map(p => ({
            key: p.key,
            value: p.value,
            context: p.context,
            strength: p.strength,
            project: p.project,
          }))),
        }],
      };
    },
  );

  // ── decay_run ─────────────────────────────────────────────────────────────

  server.tool(
    'decay_run',
    'Manually trigger a memory decay pass',
    {},
    () => {
      const decayed = memSvc.applyDecay();
      const promoted = memSvc.evaluateTierPromotions();
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ memoriesDecayed: decayed, memoriesPromoted: promoted }),
        }],
      };
    },
  );

  // ── stats ─────────────────────────────────────────────────────────────────

  server.tool(
    'stats',
    'Get Chronicle memory statistics',
    { project: z.string().optional() },
    (args) => {
      const total = memRepo.count(args.project ? { project: args.project } : undefined);
      const buffer = memRepo.count({ tier: 'buffer', ...(args.project ? { project: args.project } : {}) });
      const working = memRepo.count({ tier: 'working', ...(args.project ? { project: args.project } : {}) });
      const core = memRepo.count({ tier: 'core', ...(args.project ? { project: args.project } : {}) });
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            total,
            byTier: { buffer, working, core },
            project: args.project,
            boosts: REINFORCEMENT_BOOSTS,
          }),
        }],
      };
    },
  );

  return server;
}
