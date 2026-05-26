/**
 * PromptLogService - stage prompt logs locally and push the buffer to Railway.
 *
 * Local-first: logs are written to prompt_log_buffer (SQLite) immediately.
 * Push is called at session_end or manually via the team tool.
 */

import { getConfig } from '../shared/config/index.js';
import type { SqliteTeamRepository } from '../adapters/repositories/sqlite-team-repository.js';
import type { IdGenerator } from '../ports/gateways/index.js';
import { createPromptLog } from '../domain/entities/prompt-log.js';
import type { CreatePromptLogInput, PromptLog } from '../domain/entities/prompt-log.js';
import { StorageError } from '../shared/exceptions/index.js';

export class PromptLogService {
  constructor(
    private teamRepo: SqliteTeamRepository,
    private idGen: IdGenerator,
  ) {}

  /**
   * Stage a prompt pattern log in the local buffer.
   * Raw content is only stored when input.shareContent is explicitly true.
   *
   * @param input - Prompt log parameters
   * @returns Buffered PromptLog
   */
  log(input: Omit<CreatePromptLogInput, 'userId' | 'teamId'>): PromptLog {
    const config = getConfig();
    if (!config.teamId) {
      throw new Error('teamId not configured - cannot log prompt');
    }

    const id = this.idGen.memoryId();
    const log = createPromptLog(id, {
      ...input,
      userId: config.userId,
      teamId: config.teamId,
    });
    this.teamRepo.bufferPromptLog(log);
    return log;
  }

  /**
   * Push all pending prompt logs from the local buffer to Railway.
   * Marks pushed rows so they are not resent on the next call.
   *
   * @returns Number of logs pushed
   */
  async pushBuffer(): Promise<number> {
    const config = getConfig();
    if (!config.railwayUrl || !config.teamId) return 0;

    const pending = this.teamRepo.getPendingPromptLogs();
    if (pending.length === 0) return 0;

    const { default: postgres } = await import('postgres');
    const sql = postgres(config.railwayUrl, { ssl: 'require', max: 3 });
    try {
      const pushed: string[] = [];
      for (const log of pending) {
        await sql`
          INSERT INTO prompt_logs
            (id, user_id, team_id, project, pattern, outcome, category, tags,
             share_content, raw_content, logged_at)
          VALUES (
            ${log.id}, ${log.userId}, ${log.teamId}, ${log.project ?? null},
            ${log.pattern}, ${log.outcome}, ${log.category},
            ${log.tags as string[]}, ${log.shareContent},
            ${log.shareContent ? (log.rawContent ?? null) : null},
            ${log.loggedAt}
          )
          ON CONFLICT (id) DO NOTHING
        `;
        pushed.push(log.id);
      }
      this.teamRepo.markPromptLogsPushed(pushed);
      return pushed.length;
    } catch (err) {
      throw new StorageError('Failed to push prompt log buffer', err);
    } finally {
      await sql.end();
    }
  }
}
