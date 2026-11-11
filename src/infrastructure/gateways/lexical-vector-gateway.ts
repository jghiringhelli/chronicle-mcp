/**
 * LexicalVectorGateway — a dependency-free vector space over text.
 *
 * ## What this is, stated plainly
 *
 * This is **not** a neural embedding. It is a hashed bag of lexical features — word tokens,
 * adjacent token pairs, and character 4-grams — projected into a fixed-dimensional space and
 * L2-normalised, so that cosine similarity is defined between any two texts. It captures
 * morphology (`rotating` ≈ `rotate`), word order within a pair (`dead letter`), and typos. It
 * does **not** capture synonymy: `dialog` and `modal` share no characters and this gateway
 * scores them at zero, where a sentence-transformer would place them close together.
 *
 * Naming it `Embedding...` would have been the overclaim this whole area is being corrected
 * for, so it is named for what it does. It satisfies `EmbeddingGateway` because the contract —
 * text in, comparable vector out, cosine defined — is exactly what recall needs, and because
 * `FastEmbedGateway` must remain a drop-in replacement for it.
 *
 * ## Why it exists at all
 *
 * The honest alternative was to leave semantic recall unavailable by default, which is the
 * state ADR-014 §2 describes and ADR-017 made universal by removing `fastembed` from the
 * install tree over nine advisories. That left the `embedding` column, the gateway port and
 * `attachEmbedding` carried with no recall consumer — ADR-014 predicted in writing that they
 * would become ghost code, and two months later they had.
 *
 * This gateway gives the default install a working vector path with:
 *   - **no new dependency** — the supply-chain trade that ADR-017 refused does not recur;
 *   - **no model download and no network** — UC-008's zero-config cold start is preserved;
 *   - **deterministic output** — the same text yields the same vector on every machine and
 *     every run, which is what makes the recall experiment reproducible.
 *
 * What it buys and what it does not is measured, not asserted: `experiments/recall` reports it
 * per query class, including the classes where it does not help.
 *
 * ## Implementation notes that are load-bearing
 *
 * - **Signed hashing.** Each feature's sign comes from a second bit of its hash, so two
 *   features colliding on one dimension cancel as often as they reinforce. With unsigned
 *   hashing, collisions only ever add, and similarity drifts upward as the vocabulary grows.
 * - **Character 4-grams are down-weighted** relative to whole tokens. At equal weight,
 *   `migration` and `migraine` score as near-neighbours on shared substrings, which trades the
 *   morphology win for a precision loss.
 * - **Stop words are dropped.** Keeping them makes every pair of English sentences similar,
 *   and it is the same defect as the SQL path's OR over `is` and `of` — which made
 *   "what is the capital of France" match almost every memory in the fixture.
 * - **Sublinear term frequency.** A word repeated ten times is more important than one
 *   mentioned once, but not ten times more.
 */

import type { EmbeddingGateway } from '../../ports/gateways/embedding-gateway.js';
import type { Embedding } from '../../domain/types.js';
import { tokenize } from '../../shared/text.js';

/**
 * Vector width.
 *
 * 512 is chosen over 384 (BGE-small's width) because collision rate, not comparability,
 * is what matters here: the two vector spaces are never mixed, and a memory embedded by one
 * gateway is re-embedded rather than compared across spaces.
 */
export const DIMENSIONS = 512;

/** Weight of a whole word token. The reference point the other feature weights are set against. */
const TOKEN_WEIGHT = 1.0;

/** Weight of an adjacent token pair. Lower than a token: a phrase is evidence, not proof. */
const BIGRAM_WEIGHT = 0.7;

/** Weight of a character 4-gram. Deliberately low — see the note on `migration`/`migraine`. */
const CHARGRAM_WEIGHT = 0.35;

/** Tokens shorter than this contribute no character n-grams; the grams would be mostly padding. */
const MIN_CHARGRAM_TOKEN = 5;

/** Character n-gram size. */
const CHARGRAM_N = 4;

/**
 * FNV-1a, 32-bit.
 *
 * Chosen for being short, dependency-free and well-distributed on short strings. Nothing here
 * is security-sensitive: the hash picks a bucket, it does not protect anything.
 *
 * @param text - Feature string
 * @returns Unsigned 32-bit hash
 */
function fnv1a(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    // Math.imul keeps the multiply in 32-bit integer space; `h * 16777619` would lose precision
    // past 2^53 and make the hash machine-dependent in the worst way: subtly.
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Character n-grams of a padded token.
 *
 * The underscore padding is what makes a prefix match count: `_rota` appears in both
 * `rotating` and `rotate`, and prefix agreement is most of what morphological similarity is.
 *
 * @param token - A single token
 * @returns Its n-grams, empty for a token below the length floor
 */
function charGrams(token: string): string[] {
  if (token.length < MIN_CHARGRAM_TOKEN) return [];
  const padded = `_${token}_`;
  const grams: string[] = [];
  for (let i = 0; i + CHARGRAM_N <= padded.length; i++) grams.push(padded.slice(i, i + CHARGRAM_N));
  return grams;
}

/**
 * Accumulate one feature into the vector, with a sign taken from the hash.
 *
 * @param vec - Vector under construction
 * @param feature - Feature string
 * @param weight - Feature weight
 */
function accumulate(vec: Float64Array, feature: string, weight: number): void {
  const h = fnv1a(feature);
  const index = h % DIMENSIONS;
  // Bit 31 as the sign. Independent enough from the low bits that choose the bucket.
  const sign = (h >>> 31) & 1 ? -1 : 1;
  // `?? 0` satisfies noUncheckedIndexedAccess; the index is always in range by construction.
  vec[index] = (vec[index] ?? 0) + sign * weight;
}

/**
 * Build the lexical vector for a text. Pure, synchronous and deterministic.
 *
 * Exported separately from the gateway because the recall path needs it synchronously — the
 * MCP tool handler for `recall` is synchronous, and a promise-returning-only gateway is the
 * reason the embedding column had no consumer for two months.
 *
 * @param text - Text to vectorise
 * @returns L2-normalised vector of length DIMENSIONS; all zeros for text with no content tokens
 */
export function lexicalVector(text: string): Embedding {
  const vec = new Float64Array(DIMENSIONS);
  const tokens = tokenize(text);

  // Sublinear term frequency, counted before projection so that repeats do not simply add.
  const counts = new Map<string, number>();
  for (const t of tokens) counts.set(t, (counts.get(t) ?? 0) + 1);

  for (const [token, count] of counts) {
    const tf = 1 + Math.log(count);
    accumulate(vec, `t:${token}`, TOKEN_WEIGHT * tf);
    for (const gram of charGrams(token)) accumulate(vec, `g:${gram}`, CHARGRAM_WEIGHT * tf);
  }

  for (let i = 0; i + 1 < tokens.length; i++) {
    accumulate(vec, `b:${tokens[i]}_${tokens[i + 1]}`, BIGRAM_WEIGHT);
  }

  let norm = 0;
  for (let i = 0; i < DIMENSIONS; i++) norm += vec[i]! * vec[i]!;
  norm = Math.sqrt(norm);
  // A text of nothing but stop words yields the zero vector, whose cosine with anything is 0.
  // That is the correct answer — "what is the capital of France" is similar to no memory — and
  // it is why `cosineSimilarity` must not divide by a zero norm.
  if (norm === 0) return Array.from(vec);

  const out = new Array<number>(DIMENSIONS);
  for (let i = 0; i < DIMENSIONS; i++) out[i] = vec[i]! / norm;
  return out;
}

/**
 * Cosine similarity between two vectors.
 *
 * Exported as a free function so a caller can rank without constructing a gateway.
 *
 * @param a - First vector
 * @param b - Second vector
 * @returns Similarity in [-1, 1]; 0 when either side is the zero vector or the widths differ
 */
export function cosine(a: Embedding, b: Embedding): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!;
    const y = b[i]!;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  if (na === 0 || nb === 0) return 0;
  // Vectors from `lexicalVector` are already unit length, so this division is usually by 1. It
  // is kept because a vector read back from the database has been through float32 truncation,
  // and because FastEmbedGateway's output is not guaranteed normalised.
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/**
 * The gateway wrapper, for callers that hold an `EmbeddingGateway`.
 *
 * Always available: there is no model to load, no package to find and no network call, so
 * `available()` is the only implementation of that method in the codebase that cannot return
 * false.
 */
export class LexicalVectorGateway implements EmbeddingGateway {
  /** Identifies which vector space a stored embedding belongs to. */
  static readonly ID = 'lexical-v1';

  /**
   * Whether embeddings can be produced. Always true for this gateway.
   *
   * @returns true
   */
  async available(): Promise<boolean> {
    return true;
  }

  /**
   * Vectorise one text.
   *
   * @param text - Text to embed
   * @returns L2-normalised lexical vector
   */
  async generate(text: string): Promise<Embedding> {
    return lexicalVector(text);
  }

  /**
   * Vectorise several texts.
   *
   * @param texts - Texts to embed
   * @returns Vectors in the same order
   */
  async generateBatch(texts: string[]): Promise<Embedding[]> {
    return texts.map((t) => lexicalVector(t));
  }

  /**
   * Cosine similarity between two vectors.
   *
   * @param a - First vector
   * @param b - Second vector
   * @returns Similarity in [-1, 1]
   */
  cosineSimilarity(a: Embedding, b: Embedding): number {
    return cosine(a, b);
  }
}
