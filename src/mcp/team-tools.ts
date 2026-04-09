/**
 * Chronicle Team MCP tool.
 *
 * A single `team` tool with an `action` enum routes all 9 former team tools.
 * Guards against missing teamId — all actions no-op gracefully.
 * Wire into server.ts via registerTeamTools().
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getConfig } from '../shared/config/index.js';
import type { TeamService } from '../services/team-service.js';
import type { PromptLogService } from '../services/prompt-log-service.js';
import type { TeamSyncService } from '../services/team-sync-service.js';
import type { PatternService } from '../services/pattern-service.js';
import type { SqliteTeamRepository } from '../adapters/repositories/sqlite-team-repository.js';
import type { MemoryRepository } from '../ports/repositories/memory-repository.js';

function noTeam() {
  return { content: [{ type: 'text' as const, text: JSON.stringify({ error: 'teamId not configured. Set teamId in ~/.chronicle/config.json and restart.' }) }] };
}

/**
 * Register the single `team` MCP tool on the server.
 *
 * @param server - McpServer to register on
 * @param teamSvc - TeamService instance
 * @param promptLogSvc - PromptLogService instance
 * @param teamSyncSvc - TeamSyncService instance
 * @param patternSvc - PatternService instance
 * @param teamRepo - SqliteTeamRepository for direct cache reads
 * @param memRepo - MemoryRepository to look up memories for sharing
 */
export function registerTeamTools(
  server: McpServer,
  teamSvc: TeamService,
  promptLogSvc: PromptLogService,
  teamSyncSvc: TeamSyncService,
  patternSvc: PatternService,
  teamRepo: SqliteTeamRepository,
  memRepo: MemoryRepository,
): void {

  // ── team ────────────────────────────────────────────────────────────────────

  server.tool(
    'team',
    'Team knowledge sharing and analytics.',
    {
      action: z.enum(['join', 'share', 'recall', 'log', 'insights', 'stats', 'sync', 'members'])
        .describe('join=setup | share=push-memory | recall=search | log=prompt-pattern | insights=practices | stats=usage(scope:me|team) | sync=push-pull | members=list'),
      // shared
      id:      z.string().optional().describe('Memory ID — used with share'),
      project: z.string().optional(),
      // join
      team_id:   z.string().optional(),
      team_name: z.string().optional(),
      // recall / insights
      query:        z.string().optional(),
      limit:        z.number().optional(),
      insight_type: z.enum(['practice', 'antipattern', 'profile', 'lesson']).optional(),
      // log
      pattern:       z.string().optional().describe('What the prompt was trying to achieve'),
      outcome:       z.enum(['good', 'bad', 'neutral']).optional(),
      category:      z.string().optional(),
      share_content: z.boolean().optional().describe('Also share raw prompt text — explicit opt-in only'),
      raw_content:   z.string().optional(),
      // stats
      scope: z.enum(['me', 'team']).optional().describe('me=personal | team=aggregate (default: team)'),
    },
    async (args) => {
      const config = getConfig();

      switch (args.action) {

        case 'join': {
          const { team, member } = await teamSvc.joinTeam(args.team_id ?? '', args.team_name ?? args.team_id ?? '', 'member');
          return {
            content: [{ type: 'text', text: JSON.stringify({
              message: `Joined team "${team.name}".`,
              teamId: team.id, role: member.role,
              hint: `Add "teamId": "${team.id}" to ~/.chronicle/config.json to activate team features.`,
            }) }],
          };
        }

        case 'share': {
          if (!config.teamId) return noTeam();
          // Look up the memory from local SQLite — no need to re-provide content
          const memory = memRepo.findById(args.id ?? '');
          if (!memory) return { content: [{ type: 'text', text: JSON.stringify({ error: `Memory ${args.id} not found.` }) }] };
          await teamSyncSvc.pushSharedMemory({
            id: memory.id,
            content: memory.content,
            memoryType: memory.memoryType,
            project: args.project ?? memory.project,
            category: memory.category,
            tags: [...memory.tags],
          });
          return { content: [{ type: 'text', text: JSON.stringify({ message: 'Memory shared with team.', id: memory.id }) }] };
        }

        case 'recall': {
          if (!config.teamId) return noTeam();
          const memories  = teamRepo.searchSharedCache(config.teamId, args.query ?? '', args.project, args.limit ?? 20);
          const insights  = teamRepo.getInsights(config.teamId, args.project);
          return {
            content: [{ type: 'text', text: JSON.stringify({ sharedMemories: memories, teamInsights: insights.map(i => ({ insightType: i.insightType, content: i.content, confidence: i.confidence, project: i.project })) }) }],
          };
        }

        case 'log': {
          if (!config.teamId) return noTeam();
          const log = promptLogSvc.log({
            pattern: args.pattern ?? '',
            outcome: args.outcome,
            category: args.category,
            project: args.project,
            shareContent: args.share_content,
            rawContent: args.raw_content,
          });
          return { content: [{ type: 'text', text: JSON.stringify({ id: log.id, message: 'Prompt pattern logged.', category: log.category, outcome: log.outcome }) }] };
        }

        case 'insights': {
          if (!config.teamId) return noTeam();
          let insights = teamRepo.getInsights(config.teamId, args.project);
          if (args.insight_type) insights = insights.filter(i => i.insightType === args.insight_type);
          return {
            content: [{ type: 'text', text: JSON.stringify(insights.map(i => ({ id: i.id, insightType: i.insightType, content: i.content, confidence: i.confidence, sourceCount: i.sourceCount, project: i.project }))) }],
          };
        }

        case 'stats': {
          if (!config.teamId) return noTeam();
          const stats = (args.scope ?? 'team') === 'me'
            ? patternSvc.myStats(args.project)
            : patternSvc.teamStats(args.project);
          return { content: [{ type: 'text', text: JSON.stringify(stats) }] };
        }

        case 'sync': {
          if (!config.teamId) return noTeam();
          const result = await teamSyncSvc.sync();
          return {
            content: [{ type: 'text', text: JSON.stringify({ ...result, message: result.skipped ? 'Skipped — railwayUrl not configured.' : 'Team sync complete.' }) }],
          };
        }

        case 'members': {
          if (!config.teamId) return noTeam();
          const members = await teamSvc.listMembers(config.teamId);
          return {
            content: [{ type: 'text', text: JSON.stringify(members.map(m => ({ userId: m.userId, role: m.role, joinedAt: m.joinedAt }))) }],
          };
        }

        default:
          return { content: [{ type: 'text', text: JSON.stringify({ error: `Unknown action: ${args.action}` }) }] };
      }
    },
  );
}
