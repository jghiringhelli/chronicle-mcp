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
import type { TeamRepository } from '../ports/repositories/team-repository.js';
import type { EmbeddingGateway } from '../ports/gateways/embedding-gateway.js';
import type { Embedding } from '../domain/types.js';
import { contradicts } from './contradiction.js';

/**
 * Token-overlap (Jaccard) at or above which two memories are the same knowledge.
 *
 * 0.20 since 2026-11-10, from 0.50. Measured against a 51-memory pool (ADR-028): 0.50 suppressed
 * 3 of 11 labelled duplicates and 0.20 suppresses 6, both losing **none** of 12 novel memories.
 * 0.15 already loses one, so 0.20 keeps one sweep step of margin.
 *
 * Not the threshold that maximises pairwise F1, which is 0.10 — applied the way this service
 * applies it, as a maximum over the whole pool, 0.10 suppresses eleven of the twelve novel
 * memories. The two errors are not symmetric: a near-duplicate left in the pool is visible and
 * deletable, a withheld memory is not.
 */
export const PROMOTE_SIMILARITY_THRESHOLD = 0.2;

/**
 * Cosine fallback for a gateway that declares no `dedupThreshold` of its own.
 *
 * Kept at 0.83 deliberately. It is the right order of magnitude for a sentence-transformer, which
 * is what it was written for, so an unknown third-party gateway inherits the conservative choice
 * — it will under-de-duplicate rather than withhold. A gateway that knows its own space should
 * declare `dedupThreshold` instead of relying on this (ADR-028 §1).
 */
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
  /**
   * The similarity floor this pass used.
   *
   * Reported because it is no longer a constant a reader can look up: it comes from whichever
   * gateway answered (ADR-028 §1), so without it the `skipped` list cannot be interpreted.
   */
  threshold: number;
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
    private readonly teamRepo: TeamRepository,
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

    const result: PromoteResult = {
      scanned: candidates.length, promoted: [], skipped: [], railwaySkipped: false,
      method: 'lexical', threshold: PROMOTE_SIMILARITY_THRESHOLD,
    };

    if (!config.railwayUrl) {
      result.railwaySkipped = true;
      return result;
    }

    // Prefer semantic (embedding) dedup; fall back to lexical when unavailable.
    const semantic = await this.buildSemanticIndex(candidates.map(c => c.content), pool.map(p => p.content));
    if (semantic) result.method = 'semantic';
    // The gateway owns the number, because two gateways both returning cosines are not on one
    // scale: the in-tree lexical space says 0.25, a sentence-transformer says 0.75, and one
    // constant for both is wrong for at least one of them (ADR-028 §1). Read after
    // buildSemanticIndex, which is what makes a composite gateway have latched onto one.
    const threshold = semantic
      ? this.embeddings?.dedupThreshold ?? SEMANTIC_SIMILARITY_THRESHOLD
      : PROMOTE_SIMILARITY_THRESHOLD;
    result.threshold = threshold;

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
      // A pair that reverses a decision is never the same knowledge, however similar the text.
      // Both similarity measures rank contradictions ABOVE genuine duplicates — "bodies are
      // never logged" against "bodies are logged at debug" scored 0.667 by Jaccard where the
      // most similar real duplicate scored 0.313 — so at the shipped threshold the only thing
      // de-duplication did was withhold memories that reversed a policy
      // (docs/evidence/dedup-experiment.json). The guard can only prevent a merge, never cause
      // one, so the worst it costs is a near-duplicate left in the pool for somebody to delete.
      const matchContent = match ? pool.find((p) => p.id === match.id)?.content : undefined;
      const reversesIt = matchContent !== undefined && contradicts(cand.content, matchContent);
      if (match && match.score >= threshold && !reversesIt) {
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
