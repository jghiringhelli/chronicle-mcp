/**
 * PromptLogService - stage prompt logs locally and push the buffer to Railway.
 *
 * Local-first: logs are written to prompt_log_buffer (SQLite) immediately.
 * Push is called at session_end or manually via the team tool.
 *
 * Two tables, two different jobs, and the difference is the whole privacy boundary:
 *
 * - `prompt_log_buffer` (local SQLite) is a **staging area**. It carries `raw_content` so the
 *   prompt history can be read back and distilled into profile, lessons and playbook. It is
 *   meant to be transient — analysed, then emptied to make room for the next stretch of history.
 * - `prompt_logs` (cloud Postgres) is the **sharing boundary**. Only the distilled pattern,
 *   outcome, category and tags cross it. The raw text does not, and the columns that once held it
 *   were dropped rather than defaulted off (ADR-019 §1).
 *
 * What is not built yet: the analysis step that reads the staged rows, and the eviction that frees
 * them. `markPromptLogsPushed` moves a row to 'pushed', which records that the *pattern* reached
 * the team — not that anyone is finished with the local raw text. Until that lands, staged rows
 * accumulate.
 */

import { getConfig } from '../shared/config/index.js';
import type { TeamRepository } from '../ports/repositories/team-repository.js';
import type { IdGenerator } from '../ports/gateways/index.js';
import { createPromptLog } from '../domain/entities/prompt-log.js';
import type { CreatePromptLogInput, PromptLog } from '../domain/entities/prompt-log.js';
import { StorageError } from '../shared/exceptions/index.js';

/** Matches the `buffer` storage tier's TTL (ADR-012), so retention is one concept, not two. */
export const DEFAULT_PROMPT_RETENTION_DAYS = 7;

export class PromptLogService {
  constructor(
    private teamRepo: TeamRepository,
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

  /** The staged rows distillation has not read yet (EDR-005), oldest first. */
  stagedForAnalysis(limit?: number): PromptLog[] {
    return this.teamRepo.getUnanalysedPromptLogs(limit);
  }

  /** Record that distillation read exactly these rows. Idempotent. */
  markAnalysed(ids: string[]): void {
    this.teamRepo.markPromptLogsAnalysed(ids);
  }

  /**
   * Free the space the analysed history no longer needs (EDR-005).
   *
   * `retentionDays` defaults to `promptRetentionDays` (7), which matches the `buffer` storage tier
   * so the system carries one retention concept rather than two (ADR-012). **0 means delete on
   * analysis.** The default is the recoverable choice on purpose: with 0, one failed distillation
   * run loses that stretch of history and there is no second pass over it.
   *
   * A row whose pattern has not reached the team is kept while a remote is configured — evicting it
   * would lose the pattern, not just the text. With no remote, `pending` is terminal and the row is
   * evictable, or an offline-only buffer would grow forever.
   *
   * @param retentionDays - Days to keep an analysed row; 0 evicts immediately
   * @returns How many rows were deleted
   */
  evictAnalysed(retentionDays?: number): number {
    const config = getConfig();
    const days = retentionDays ?? config.promptRetentionDays ?? DEFAULT_PROMPT_RETENTION_DAYS;
    const before = new Date(Date.now() - days * 86_400_000).toISOString();
    return this.teamRepo.evictAnalysedPromptLogs(before, config.railwayUrl !== undefined);
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
        // ADR-019 §1: the distilled pattern crosses the boundary; the raw text never does. The
        // columns are absent from the cloud table on purpose, so naming them here would both fail
        // against the real database and, on a fresh one, carry prompt text into a shared store.
        await sql`
          INSERT INTO prompt_logs
            (id, user_id, team_id, project, pattern, outcome, category, tags, logged_at)
          VALUES (
            ${log.id}, ${log.userId}, ${log.teamId}, ${log.project ?? null},
            ${log.pattern}, ${log.outcome}, ${log.category},
            ${log.tags as string[]}, ${log.loggedAt}
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
