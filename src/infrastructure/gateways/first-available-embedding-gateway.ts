/**
 * FirstAvailableEmbeddingGateway — prefer a model, fall back to the in-process vectors.
 *
 * ## Why this exists
 *
 * ADR-017 removed `fastembed` from the install tree over nine advisories, and kept the upgrade
 * path open: *"Semantic de-duplication stays available to anyone who wants it, by installing the
 * package themselves."* `src/mcp/server.ts` therefore handed `TeamPromotionService` a
 * `FastEmbedGateway`, which on a default install reports unavailable — so the service fell back
 * to lexical similarity, which is the path measured at precision 0.00 with two contradictory
 * memories merged (`docs/evidence/dedup-experiment.json`).
 *
 * Replacing that with `LexicalVectorGateway` outright would fix the default and quietly delete
 * the upgrade ADR-017 promised: a user who had installed `fastembed` would stop getting the
 * model. This gateway keeps both — the model when it is there, the dependency-free vectors when
 * it is not — so neither case is the one nobody tested.
 *
 * ## The one thing to know about it
 *
 * Availability is resolved **once**, on the first call, and then held. Re-probing per call would
 * mean an `await import('fastembed')` on every promote, and a gateway whose answer changes
 * mid-session would make two de-duplication passes incomparable: the same pair of memories could
 * be judged in two different vector spaces, which is a difference no caller can see and none
 * would expect.
 */

import type { EmbeddingGateway } from '../../ports/gateways/embedding-gateway.js';
import type { Embedding } from '../../domain/types.js';

export class FirstAvailableEmbeddingGateway implements EmbeddingGateway {
  private chosen: EmbeddingGateway | null = null;

  /**
   * @param candidates - Gateways in preference order. The last one should be unconditionally
   *   available, or `available()` can still answer false — which callers must handle anyway
   *   (ADR-014 §2: an absent gateway is a normal state, never an error).
   */
  constructor(private readonly candidates: readonly EmbeddingGateway[]) {}

  /**
   * Resolve and remember the first candidate that reports itself available.
   *
   * A candidate whose `available()` throws is treated as unavailable rather than propagated: the
   * port forbids that method from throwing, and a gateway that breaks the contract should cost
   * the feature, not the process.
   *
   * @returns The chosen gateway, or null when none is available
   */
  private async resolve(): Promise<EmbeddingGateway | null> {
    if (this.chosen) return this.chosen;
    for (const candidate of this.candidates) {
      try {
        if (await candidate.available()) {
          this.chosen = candidate;
          return candidate;
        }
      } catch {
        // Try the next one.
      }
    }
    return null;
  }

  /**
   * Whether any candidate can produce embeddings.
   *
   * @returns true when at least one candidate is available
   */
  async available(): Promise<boolean> {
    return (await this.resolve()) !== null;
  }

  /**
   * Embed one text with the chosen gateway.
   *
   * @param text - Text to embed
   * @returns The vector
   * @throws When no candidate is available
   */
  async generate(text: string): Promise<Embedding> {
    const gw = await this.resolve();
    if (!gw) throw new Error('No embedding gateway is available');
    return gw.generate(text);
  }

  /**
   * Embed several texts with the chosen gateway.
   *
   * @param texts - Texts to embed
   * @returns Vectors in the same order
   * @throws When no candidate is available
   */
  async generateBatch(texts: string[]): Promise<Embedding[]> {
    const gw = await this.resolve();
    if (!gw) throw new Error('No embedding gateway is available');
    return gw.generateBatch(texts);
  }

  /**
   * Cosine similarity, delegated to whichever gateway produced the vectors.
   *
   * Synchronous by contract, so this cannot await the resolution. It uses the already-chosen
   * gateway and otherwise the first candidate — safe because comparing two vectors only needs a
   * dot product, and every implementation here computes the same one. Mixing vectors from two
   * different gateways would be meaningless whichever one did the arithmetic, which is why
   * `resolve()` latches.
   *
   * @param a - First vector
   * @param b - Second vector
   * @returns Similarity in [-1, 1], or 0 when there are no candidates at all
   */
  cosineSimilarity(a: Embedding, b: Embedding): number {
    const gw = this.chosen ?? this.candidates[0];
    return gw ? gw.cosineSimilarity(a, b) : 0;
  }
}
