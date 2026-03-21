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
