/**
 * Embedding Gateway Port
 *
 * Interface for generating vector embeddings from text.
 * Infrastructure layer provides the concrete implementation.
 */

import type { Embedding } from '../../domain/types.js';

/**
 * Embedding Gateway Interface
 *
 * Abstracts the embedding generation mechanism.
 * Implementations may use local models, OpenAI API, or other providers.
 */
export interface EmbeddingGateway {
  /**
   * Cosine at or above which this gateway's vectors mean "the same knowledge", for
   * de-duplication.
   *
   * On the gateway and not in the service because **two gateways both returning cosines are not
   * on one scale**. A hashed lexical space puts unrelated English near zero; a
   * sentence-transformer puts it around 0.3-0.5. One constant served to both is wrong for at
   * least one of them, and the symptom is invisible: either nothing is ever de-duplicated, or
   * memories stop reaching the team.
   *
   * Values are measured against a pool, not against pairs — see ADR-028 for the selection rule
   * and `docs/evidence/dedup-experiment.json` for the curves. Optional so that a gateway written
   * elsewhere keeps working; the service falls back to its own constant.
   */
  readonly dedupThreshold?: number;

  /**
   * Whether embeddings can actually be produced right now.
   *
   * Declared on the port, not just the adapter, because services branch on it: semantic
   * de-duplication falls back to lexical when this is false (ADR-014, ADR-017). A service
   * calling a method the port does not declare is a Composable violation — and was one: this
   * method existed only on FastEmbedGateway while TeamPromotionService called it through the
   * port type, which the branch's broken typecheck never caught.
   *
   * MUST NOT throw. An unavailable gateway is a normal state, not an error.
   *
   * @returns true when generate/generateBatch will succeed
   */
  available(): Promise<boolean>;

  /**
   * Generate embedding for text content.
   *
   * @param text - Text to embed
   * @returns Vector embedding
   */
  generate(text: string): Promise<Embedding>;

  /**
   * Generate embeddings for multiple texts in batch.
   * More efficient than individual calls for bulk operations.
   *
   * @param texts - Array of texts to embed
   * @returns Array of embeddings in same order
   */
  generateBatch(texts: string[]): Promise<Embedding[]>;

  /**
   * Compute cosine similarity between two embeddings.
   *
   * @param a - First embedding
   * @param b - Second embedding
   * @returns Similarity score between -1 and 1
   */
  cosineSimilarity(a: Embedding, b: Embedding): number;
}
