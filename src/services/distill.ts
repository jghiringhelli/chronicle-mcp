/**
 * DistillService — the intelligence layer synthesis: profile, lessons, playbook.
 *
 * Reads the memories captured during the session **and** the prompt history staged in
 * `prompt_log_buffer` (EDR-005), and asks a model to update the developer profile, the lessons and
 * the playbook. The distilled output goes to the local `insights` table and syncs to Railway; the
 * raw prompt text that fed it never does (ADR-019 §1, ADR-026).
 *
 * **Two phases, because this server cannot sample.** There is no MCP sampling support here and the
 * client would have to offer it, so the halves are exposed as one action with two modes:
 * `session(action:'distill')` returns `buildDistillPrompt`'s output and the ids it covers;
 * `session(action:'distill', result)` runs `applyDistillResult`, marks those ids analysed and
 * evicts what retention releases. The calling agent *is* the model, so its own turn is the
 * round-trip. The shape mirrors `gs step`: without arguments it says what it needs, with them it acts.
 */

import type { Memory } from '../domain/entities/memory.js';
import type { PromptLog } from '../domain/entities/prompt-log.js';
import { getDatabase } from '../infrastructure/db/database.js';
import crypto from 'node:crypto';

export interface InsightUpdate {
  insightType: 'profile' | 'lesson' | 'playbook' | 'bias';
  project: string | null;
  content: string;
  confidence: number;
}

/**
 * Build the distillation prompt for the LLM.
 * Returns a prompt string that asks the model to update the intelligence layer.
 */
export function buildDistillPrompt(
  newMemories: Memory[],
  existingInsights: Record<string, string>,
  promptHistory: readonly PromptLog[] = []
): string {
  const memoriesList = newMemories
    .map(m => `- [${m.memoryType}] ${m.content}${m.project ? ` (project: ${m.project})` : ''}`)
    .join('\n');

  // EDR-005: two sources, two jobs. The memories carry the facts; the staged prompt history carries
  // the work and the style — what was attempted and how it went — which is the half that makes this
  // a chronicle rather than a store. The raw text is included when it was staged, and it never
  // leaves this machine: this string is handed to the calling agent, not written anywhere.
  const historyList = promptHistory
    .map(p => {
      const head = `- [${p.outcome}/${p.category}] ${p.pattern}`;
      return p.rawContent ? `${head}\n    verbatim: ${p.rawContent}` : head;
    })
    .join('\n');
  const historySection = historyList === ''
    ? ''
    : `\n## Prompt history staged this stretch (what was attempted, and how it went):\n${historyList}\n`;

  const existingProfile  = existingInsights['profile']  ?? '(none yet)';
  const existingLessons  = existingInsights['lesson']   ?? '(none yet)';
  const existingPlaybook = existingInsights['playbook'] ?? '(none yet)';

  return `You are updating a developer's persistent memory profile. Based on NEW MEMORIES and the PROMPT HISTORY from this session, update the intelligence layer.

## New memories captured this session:
${memoriesList}
${historySection}
## Current intelligence layer:
### Developer Profile (preferences, patterns, tendencies):
${existingProfile}

### Lessons Learned (cross-project insights, mistakes, solutions):
${existingLessons}

### Coding Playbook (procedures, workflows, best practices):
${existingPlaybook}

## Instructions:
Return a JSON object with these keys (only include keys that have meaningful updates):
{
  "profile":  "<updated developer profile — integrate new preferences/patterns>",
  "lesson":   "<updated lessons — add any new cross-project insights>",
  "playbook": "<updated playbook — add any new procedures or solutions>",
  "bias":     "<any AI behavior patterns observed — optional>"
}

Rules:
- Keep each section concise (max 500 words each)
- Merge new information — do not discard existing knowledge
- If nothing new warrants updating a section, omit that key
- Write in second person ("You prefer...", "When working with...")`;
}

/**
 * Apply distillation results to the local insights table.
 * Called after receiving the LLM response.
 */
export function applyDistillResult(
  updates: Record<string, string>,
  sessionProject?: string
): void {
  const db = getDatabase();
  const now = new Date().toISOString();

  for (const [insightType, content] of Object.entries(updates)) {
    if (!content || typeof content !== 'string') continue;

    // Valid types only
    if (!['profile', 'lesson', 'playbook', 'bias'].includes(insightType)) continue;

    const existing = db.prepare(
      `SELECT id, version FROM insights WHERE insight_type = ? AND project IS ?`
    ).get(insightType, sessionProject ?? null) as { id: string; version: number } | undefined;

    if (existing) {
      db.prepare(
        `UPDATE insights SET content = ?, confidence = 0.8, version = version + 1, updated_at = ? WHERE id = ?`
      ).run(content, now, existing.id);
    } else {
      db.prepare(`
        INSERT INTO insights (id, insight_type, project, content, confidence, source_count, version, updated_at)
        VALUES (?, ?, ?, ?, 0.8, 1, 1, ?)
      `).run(crypto.randomUUID(), insightType, sessionProject ?? null, content, now);
    }
  }
}

/**
 * Get existing insights as a string map for use in the distill prompt.
 */
export function getExistingInsights(project?: string): Record<string, string> {
  const db = getDatabase();
  const rows = db.prepare(
    `SELECT insight_type, content FROM insights WHERE project IS ? OR project IS NULL ORDER BY version DESC`
  ).all(project ?? null) as { insight_type: string; content: string }[];

  const map: Record<string, string> = {};
  for (const row of rows) {
    if (!map[row.insight_type]) {
      map[row.insight_type] = row.content;
    }
  }
  return map;
}
