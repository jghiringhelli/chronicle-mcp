/**
 * Chronicle `team` MCP tool — team knowledge sharing and analytics.
 *
 * A single `team` tool with an `action` enum routes all team knowledge
 * operations. Gated by the same Chronicle Team license as `axon`.
 * Wire into server.ts via registerTeamTools().
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getConfig } from '../shared/config/index.js';
import { validateTeamToken } from './team-gate.js';
import { canCurate } from '../domain/entities/team.js';
import type { TeamService } from '../services/team-service.js';
import type { PromptLogService } from '../services/prompt-log-service.js';
import type { TeamSyncService } from '../services/team-sync-service.js';
import type { PatternService } from '../services/pattern-service.js';
import type { TeamPromotionService } from '../services/team-promotion-service.js';
import type { SqliteTeamRepository } from '../adapters/repositories/sqlite-team-repository.js';
import type { MemoryRepository } from '../ports/repositories/memory-repository.js';

type ToolResult = { content: Array<{ type: 'text'; text: string }> };

function reply(payload: unknown): ToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(payload) }] };
}

/**
 * Register the single `team` MCP tool on the server.
 *
 * @param server - McpServer to register on
 * @param deps - Wired team services and repositories
 */
export function registerTeamTools(
  server: McpServer,
  deps: {
    teamSvc: TeamService;
    promptLogSvc: PromptLogService;
    teamSyncSvc: TeamSyncService;
    patternSvc: PatternService;
    promotionSvc: TeamPromotionService;
    teamRepo: SqliteTeamRepository;
    memRepo: MemoryRepository;
  },
): void {
  const { teamSvc, promptLogSvc, teamSyncSvc, patternSvc, promotionSvc, teamRepo, memRepo } = deps;

  server.tool(
    'team',
    [
      'Shared team knowledge built on Chronicle. Requires a Chronicle Team license (teamToken + teamId).',
      '',
      'SHARE a memory the rest of the team should inherit; RECALL pulls the team pool plus synthesized insights; LOG records what a prompt was trying to do (pattern only — raw text stays local unless you opt in).',
      '',
      'Memories in the shared pool stay attributed to their author; INSIGHTS are team-level syntheses curated by owners/leads.',
    ].join('\n'),
    {
      action: z.enum(['join', 'share', 'promote', 'recall', 'log', 'insights', 'stats', 'sync', 'members', 'assign_role', 'curate_insight'])
        .describe('join=register-membership | share=push-memory-by-id | promote=auto-share-worthy-memories(deduped) | recall=search-team-pool | log=record-prompt-pattern | insights=team-practices | stats=usage(scope:me|team) | sync=push-pull | members=list | assign_role=set-member-role(owner/lead) | curate_insight=create/reinforce-team-insight(owner/lead)'),
      // shared
      id:      z.string().optional().describe('Memory ID — used with share'),
      project: z.string().optional(),
      // join
      team_name: z.string().optional().describe('Display name when first creating the team'),
      // recall / insights / curate_insight
      query:        z.string().optional(),
      limit:        z.number().optional(),
      insight_type: z.enum(['practice', 'antipattern', 'profile', 'lesson']).optional(),
      content:      z.string().optional().describe('Insight text — used with curate_insight'),
      // assign_role (owner/lead only)
      target_user_id: z.string().optional().describe('User whose role to set'),
      role:            z.enum(['owner', 'lead', 'member']).optional().describe('Role to assign'),
      // log
      pattern:       z.string().optional().describe('What the prompt was trying to achieve'),
      outcome:       z.enum(['good', 'bad', 'neutral']).optional(),
      category:      z.string().optional(),
      share_content: z.boolean().optional().describe('Also share raw prompt text — explicit opt-in only'),
      raw_content:   z.string().optional(),
      // stats
      scope: z.enum(['me', 'team']).optional().describe('me=personal | team=aggregate (default: team)'),
    },
    async (args): Promise<ToolResult> => {
      const config = getConfig();

      // ── License gate (shared with axon) ────────────────────────────────────
      if (!config.teamToken) {
        return reply({ error: 'Team features require a Chronicle Team license. Add teamToken to ~/.chronicle/config.json. Generate one with: chronicle-mcp generate-token --team <slug>' });
      }
      if (!config.teamId) {
        return reply({ error: 'Team features require teamId in ~/.chronicle/config.json.' });
      }
      const tokenOk = await validateTeamToken(config.teamToken, config.railwayUrl, config.teamId);
      if (!tokenOk) {
        return reply({ error: 'Invalid or revoked teamToken. Generate a new one with: chronicle-mcp generate-token --team <slug>' });
      }

      const teamId = config.teamId;

      switch (args.action) {

        case 'join': {
          const { team, member } = await teamSvc.joinTeam(teamId, args.team_name ?? teamId);
          return reply({ message: `Joined team "${team.name}".`, teamId: team.id, role: member.role });
        }

        case 'share': {
          const memory = memRepo.findById(args.id ?? '');
          if (!memory) return reply({ error: `Memory ${args.id} not found.` });
          await teamSyncSvc.pushSharedMemory({
            id: memory.id,
            content: memory.content,
            memoryType: memory.memoryType,
            project: args.project ?? memory.project,
            category: memory.category,
            tags: [...memory.tags],
          });
          return reply({ message: 'Memory shared with team.', id: memory.id });
        }

        case 'promote': {
          const result = await promotionSvc.promote(args.project, args.limit);
          return reply({
            ...result,
            message: result.railwaySkipped
              ? 'Skipped — railwayUrl not configured.'
              : `Promoted ${result.promoted.length} of ${result.scanned} candidate(s); skipped ${result.skipped.length}.`,
          });
        }

        case 'recall': {
          const memories = teamRepo.searchSharedCache(teamId, args.query ?? '', args.project, args.limit ?? 20);
          const insights = teamRepo.getInsights(teamId, args.project);
          return reply({
            sharedMemories: memories,
            teamInsights: insights.map(i => ({ insightType: i.insightType, content: i.content, confidence: i.confidence, project: i.project })),
          });
        }

        case 'log': {
          const log = promptLogSvc.log({
            pattern: args.pattern ?? '',
            outcome: args.outcome,
            category: args.category,
            project: args.project,
            shareContent: args.share_content,
            rawContent: args.raw_content,
          });
          return reply({ id: log.id, message: 'Prompt pattern logged.', category: log.category, outcome: log.outcome });
        }

        case 'insights': {
          let insights = teamRepo.getInsights(teamId, args.project);
          if (args.insight_type) insights = insights.filter(i => i.insightType === args.insight_type);
          return reply(insights.map(i => ({ id: i.id, insightType: i.insightType, content: i.content, confidence: i.confidence, sourceCount: i.sourceCount, project: i.project })));
        }

        case 'stats': {
          const stats = (args.scope ?? 'team') === 'me'
            ? patternSvc.myStats(args.project)
            : patternSvc.teamStats(args.project);
          return reply(stats);
        }

        case 'sync': {
          const result = await teamSyncSvc.sync();
          return reply({ ...result, message: result.skipped ? 'Skipped — railwayUrl not configured.' : 'Team sync complete.' });
        }

        case 'members': {
          const members = await teamSvc.listMembers(teamId);
          return reply(members.map(m => ({ userId: m.userId, role: m.role, joinedAt: m.joinedAt })));
        }

        case 'assign_role': {
          const role = await teamSvc.getMemberRole(teamId);
          if (!role || !canCurate(role)) {
            return reply({ error: `Assigning roles requires owner or lead. Your role: ${role ?? 'not a member'}.` });
          }
          if (!args.target_user_id || !args.role) return reply({ error: 'target_user_id and role are required.' });
          const member = await teamSvc.assignRole(teamId, args.target_user_id, args.role);
          return reply({ message: `Assigned ${args.role} to ${args.target_user_id}.`, member });
        }

        case 'curate_insight': {
          const role = await teamSvc.getMemberRole(teamId);
          if (!role || !canCurate(role)) {
            return reply({ error: `Curating insights requires owner or lead. Your role: ${role ?? 'not a member'}.` });
          }
          if (!args.insight_type || !args.content) return reply({ error: 'insight_type and content are required.' });
          const insight = await teamSyncSvc.pushInsight({ insightType: args.insight_type, content: args.content, project: args.project });
          return reply({ message: 'Team insight curated.', insight });
        }

        default:
          return reply({ error: `Unknown action: ${args.action as string}` });
      }
    },
  );
}
