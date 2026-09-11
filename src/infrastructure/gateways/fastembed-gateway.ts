/**
 * FastEmbedGateway — CPU embedding via the optional `fastembed` dependency.
 *
 * fastembed is an OPTIONAL dependency: it pulls native binaries (onnxruntime,
 * tokenizers) and downloads a model on first use. This gateway therefore:
 *   - dynamically imports fastembed so a missing/failed install does not break
 *     the process at load time;
 *   - lazily initialises the model once, on first embed;
 *   - throws EmbeddingError when unavailable, so callers fall back (e.g. the
 *     promote action degrades to lexical similarity).
 *
 * Model: BGE-small-en-v1.5 (384-dim), CPU execution provider. Weights are
 * cached under ~/.chronicle/models so the download happens once per machine.
 */

import os from 'node:os';
import path from 'node:path';
import type { EmbeddingGateway } from '../../ports/gateways/embedding-gateway.js';
import type { Embedding } from '../../domain/types.js';
import { EmbeddingError } from '../../shared/exceptions/index.js';

/** Minimal shape of the fastembed model we depend on (kept loose — optional dep). */
interface FlagEmbeddingModel {
  embed(texts: string[], batchSize?: number): AsyncGenerator<number[][], void, unknown>;
  queryEmbed(query: string): Promise<number[]>;
}

const DEFAULT_BATCH_SIZE = 32;

export class FastEmbedGateway implements EmbeddingGateway {
  private modelPromise: Promise<FlagEmbeddingModel> | null = null;
  private unavailable = false;

  /**
   * @param cacheDir - Where model weights are cached. Defaults to ~/.chronicle/models.
   */
  constructor(private readonly cacheDir = path.join(os.homedir(), '.chronicle', 'models')) {}

  /**
   * Whether embeddings can currently be produced (the model loads successfully).
   * Never throws — returns false when fastembed is missing or the model load fails.
   *
   * @returns True if a subsequent generate/generateBatch will work
   */
  async available(): Promise<boolean> {
    try {
      await this.model();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Generate an embedding for a single text.
   *
   * @param text - Text to embed
   * @returns 384-dim embedding
   * @throws {EmbeddingError} when fastembed is unavailable
   */
  async generate(text: string): Promise<Embedding> {
    const model = await this.model();
    return model.queryEmbed(text);
  }

  /**
   * Generate embeddings for many texts in batched passes.
   *
   * @param texts - Texts to embed
   * @returns Embeddings in input order
   * @throws {EmbeddingError} when fastembed is unavailable
   */
  async generateBatch(texts: string[]): Promise<Embedding[]> {
    if (texts.length === 0) return [];
    const model = await this.model();
    const out: Embedding[] = [];
    for await (const batch of model.embed(texts, DEFAULT_BATCH_SIZE)) {
      for (const vector of batch) out.push(vector);
    }
    return out;
  }

  /**
   * Cosine similarity between two equal-length embeddings.
   *
   * @param a - First embedding
   * @param b - Second embedding
   * @returns Similarity in [-1, 1]; 0 for empty or mismatched-length inputs
   */
  cosineSimilarity(a: Embedding, b: Embedding): number {
    if (a.length === 0 || a.length !== b.length) return 0;
    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i++) {
      const x = a[i]!;
      const y = b[i]!;
      dot += x * y;
      normA += x * x;
      normB += y * y;
    }
    if (normA === 0 || normB === 0) return 0;
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  /** Lazily load (and memoize) the fastembed model. */
  private async model(): Promise<FlagEmbeddingModel> {
    if (this.unavailable) throw new EmbeddingError('fastembed is unavailable');
    if (!this.modelPromise) {
      this.modelPromise = this.load().catch((err: unknown) => {
        this.unavailable = true;
        this.modelPromise = null;
        throw new EmbeddingError(`Failed to initialise fastembed: ${String(err)}`);
      });
    }
    return this.modelPromise;
  }

  /** Dynamically import the optional dependency and initialise the model. */
  private async load(): Promise<FlagEmbeddingModel> {
    // Non-literal specifier keeps the bundler from hard-linking the optional dep.
    const mod = (await import('fastembed')) as unknown as {
      FlagEmbedding: { init(options: Record<string, unknown>): Promise<FlagEmbeddingModel> };
      EmbeddingModel: Record<string, string>;
      ExecutionProvider: Record<string, string>;
    };
    return mod.FlagEmbedding.init({
      model: mod.EmbeddingModel['BGESmallENV15'],
      executionProviders: [mod.ExecutionProvider['CPU']],
      cacheDir: this.cacheDir,
      showDownloadProgress: false,
    });
  }
}
