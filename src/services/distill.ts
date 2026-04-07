/**
 * DistillService — LLM-powered intelligence layer synthesis.
 *
 * At session_end, takes the memories captured during the session and asks
 * the LLM (via MCP sampling) to update the developer profile, lessons, and playbook.
 *
 * The distilled output is stored in the local `insights` table and synced to Railway.
 */

import type { Memory } from '../domain/entities/memory.js';
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
  existingInsights: Record<string, string>
): string {
  const memoriesList = newMemories
    .map(m => `- [${m.memoryType}] ${m.content}${m.project ? ` (project: ${m.project})` : ''}`)
    .join('\n');

  const existingProfile  = existingInsights['profile']  ?? '(none yet)';
  const existingLessons  = existingInsights['lesson']   ?? '(none yet)';
  const existingPlaybook = existingInsights['playbook'] ?? '(none yet)';

  return `You are updating a developer's persistent memory profile. Based on NEW MEMORIES from this session, update the intelligence layer.

## New memories captured this session:
${memoriesList}

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
