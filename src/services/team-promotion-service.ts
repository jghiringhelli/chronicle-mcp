/**
 * TeamPromotionService - assistant-driven promotion of personal memories
 * into the team-shared pool.
 *
 * The assistant calls `promote` when it judges that recent durable knowledge
 * is worth the rest of the team inheriting. The service selects high-value
 * candidates (confirmed truths and working/core-tier memories), de-duplicates
 * them against what the team already holds, and pushes only the novel ones.
 *
 * De-duplication is lexical (token Jaccard) for now. A semantic upgrade is
 * possible once a concrete embedding gateway populates memory embeddings;
 * the threshold constant and seam below are designed for that swap.
 */

import type { Database } from 'better-sqlite3';
import { getConfig } from '../shared/config/index.js';
import type { TeamSyncService } from './team-sync-service.js';
import type { SqliteTeamRepository } from '../adapters/repositories/sqlite-team-repository.js';
import type { EmbeddingGateway } from '../ports/gateways/embedding-gateway.js';
import type { Embedding } from '../domain/types.js';

/** Two memories at or above this token-overlap (lexical) are treated as the same knowledge. */
export const PROMOTE_SIMILARITY_THRESHOLD = 0.5;

/** Cosine similarity at or above which two memories are treated as the same knowledge (semantic). */
export const SEMANTIC_SIMILARITY_THRESHOLD = 0.83;

/** Default ceiling on how many candidates a single promote pass considers. */
export const PROMOTE_DEFAULT_LIMIT = 25;

interface CandidateRow {
  id: string;
  content: string;
  memory_type: string;
  project: string | null;
  category: string | null;
  tags: string;
}

export interface PromoteResult {
  scanned: number;
  promoted: Array<{ id: string; content: string }>;
  skipped: Array<{ id: string; reason: 'already-shared' | 'duplicate'; similarTo?: string }>;
  railwaySkipped: boolean;
  /** Which similarity method de-duplicated this pass. */
  method: 'semantic' | 'lexical';
}

/**
 * Tokenize text into a lowercase word set for lexical comparison.
 * Tokens shorter than 3 characters are dropped as low-signal.
 *
 * @param text - Raw content
 * @returns Set of normalized tokens
 */
export function tokenize(text: string): Set<string> {
  const tokens = text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(t => t.length >= 3);
  return new Set(tokens);
}

/**
 * Jaccard similarity between two contents over their token sets.
 *
 * @param a - First content
 * @param b - Second content
 * @returns Overlap in [0, 1]; 0 when either side has no tokens
 */
export function contentSimilarity(a: string, b: string): number {
  const sa = tokenize(a);
  const sb = tokenize(b);
  if (sa.size === 0 || sb.size === 0) return 0;
  let intersection = 0;
  for (const t of sa) if (sb.has(t)) intersection++;
  const union = sa.size + sb.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

export class TeamPromotionService {
  constructor(
    private readonly db: Database,
    private readonly teamRepo: SqliteTeamRepository,
    private readonly teamSyncSvc: TeamSyncService,
    /** Optional — when present and loadable, dedup uses cosine; otherwise lexical. */
    private readonly embeddings?: EmbeddingGateway,
  ) {}

  /**
   * Promote high-value local memories into the team-shared pool, skipping
   * anything already shared or near-duplicate to existing team knowledge.
   *
   * @param project - Optional project filter for candidates and the dedup pool
   * @param limit - Max candidates to consider this pass
   * @returns A breakdown of what was promoted and what was skipped, and why
   */
  async promote(project?: string, limit = PROMOTE_DEFAULT_LIMIT): Promise<PromoteResult> {
    const config = getConfig();
    const teamId = config.teamId ?? '';

    const candidates = this.selectCandidates(project, limit);
    const pool = this.teamRepo.searchSharedCache(teamId, '', project, 1000);

    const result: PromoteResult = { scanned: candidates.length, promoted: [], skipped: [], railwaySkipped: false, method: 'lexical' };

    if (!config.railwayUrl) {
      result.railwaySkipped = true;
      return result;
    }

    // Prefer semantic (embedding) dedup; fall back to lexical when unavailable.
    const semantic = await this.buildSemanticIndex(candidates.map(c => c.content), pool.map(p => p.content));
    if (semantic) result.method = 'semantic';
    const threshold = semantic ? SEMANTIC_SIMILARITY_THRESHOLD : PROMOTE_SIMILARITY_THRESHOLD;

    for (let i = 0; i < candidates.length; i++) {
      const cand = candidates[i]!;
      // Exact: a memory already shared appears in the pool under the same id.
      if (pool.some(p => p.id === cand.id)) {
        result.skipped.push({ id: cand.id, reason: 'already-shared' });
        continue;
      }
      // Near-duplicate against existing team knowledge.
      const match = semantic
        ? this.closestSemantic(semantic.candidateEmbeddings[i]!, semantic.poolEmbeddings, pool)
        : this.closestLexical(cand.content, pool);
      if (match && match.score >= threshold) {
        result.skipped.push({ id: cand.id, reason: 'duplicate', similarTo: match.id });
        continue;
      }
      await this.teamSyncSvc.pushSharedMemory({
        id: cand.id,
        content: cand.content,
        memoryType: cand.memory_type,
        project: cand.project ?? project,
        category: cand.category ?? undefined,
        tags: JSON.parse(cand.tags || '[]') as string[],
      });
      result.promoted.push({ id: cand.id, content: cand.content });
    }

    return result;
  }

  /**
   * Select promotion candidates: confirmed truths or working/core-tier memories,
   * most weighty first.
   */
  private selectCandidates(project: string | undefined, limit: number): CandidateRow[] {
    const base = `
      SELECT id, content, memory_type, project, category, tags
      FROM memories
      WHERE (confirmed = 1 OR tier IN ('working', 'core'))
    `;
    if (project) {
      return this.db.prepare(`${base} AND project = ? ORDER BY weight DESC, last_accessed_at DESC LIMIT ?`)
        .all(project, limit) as CandidateRow[];
    }
    return this.db.prepare(`${base} ORDER BY weight DESC, last_accessed_at DESC LIMIT ?`)
      .all(limit) as CandidateRow[];
  }

  /**
   * Embed candidate and pool contents for cosine dedup. Returns null when no
   * embedding gateway is configured or it cannot load — caller falls back to lexical.
   */
  private async buildSemanticIndex(
    candidateTexts: string[],
    poolTexts: string[],
  ): Promise<{ candidateEmbeddings: Embedding[]; poolEmbeddings: Embedding[] } | null> {
    if (!this.embeddings) return null;
    try {
      if (!(await this.embeddings.available())) return null;
      const [candidateEmbeddings, poolEmbeddings] = await Promise.all([
        this.embeddings.generateBatch(candidateTexts),
        this.embeddings.generateBatch(poolTexts),
      ]);
      return { candidateEmbeddings, poolEmbeddings };
    } catch {
      return null;
    }
  }

  /** Closest pool entry to a candidate by cosine similarity of embeddings. */
  private closestSemantic(
    candidate: Embedding,
    poolEmbeddings: Embedding[],
    pool: ReadonlyArray<{ id: string }>,
  ): { id: string; score: number } | undefined {
    let best: { id: string; score: number } | undefined;
    for (let i = 0; i < pool.length; i++) {
      const score = this.embeddings!.cosineSimilarity(candidate, poolEmbeddings[i]!);
      if (!best || score > best.score) best = { id: pool[i]!.id, score };
    }
    return best;
  }

  /** Closest pool entry to a candidate's content by lexical token overlap. */
  private closestLexical(
    content: string,
    pool: ReadonlyArray<{ id: string; content: string }>,
  ): { id: string; score: number } | undefined {
    let best: { id: string; score: number } | undefined;
    for (const p of pool) {
      const score = contentSimilarity(content, p.content);
      if (!best || score > best.score) best = { id: p.id, score };
    }
    return best;
  }
}
