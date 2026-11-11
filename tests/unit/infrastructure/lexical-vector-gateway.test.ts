import { describe, it, expect } from 'vitest';
import {
  LexicalVectorGateway, lexicalVector, cosine, DIMENSIONS,
} from '../../../src/infrastructure/gateways/lexical-vector-gateway.js';

/**
 * The vector path that ships by default.
 *
 * Two kinds of assertion live here and the second kind is the unusual one: as well as pinning
 * what this gateway can do, several tests pin what it **cannot**. `dialog` and `modal` are
 * asserted to be far apart, because that limitation is the published justification for not
 * making the vector path the default ranker, and a future change that quietly fixed or worsened
 * it would otherwise invalidate the recall report without failing anything.
 */
describe('lexicalVector', () => {
  it('is deterministic across calls', () => {
    expect(lexicalVector('terraform state locking')).toEqual(lexicalVector('terraform state locking'));
  });

  it('produces a vector of the declared width', () => {
    expect(lexicalVector('anything at all').length).toBe(DIMENSIONS);
  });

  it('returns a unit vector', () => {
    const v = lexicalVector('invoice pdf rendering moved to a background worker');
    const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
    expect(norm).toBeCloseTo(1, 10);
  });

  it('returns the zero vector for text with no content words', () => {
    // Not an error state: "what is it about" is similar to no memory, and cosine against the
    // zero vector is 0, which is the honest answer rather than a low-confidence guess.
    const v = lexicalVector('what is it about');
    expect(v.every((x) => x === 0)).toBe(true);
  });

  it('ignores word order outside adjacent pairs', () => {
    // Bigrams make the two differ, but only slightly: the shared unigrams dominate.
    const a = lexicalVector('connection pool exhausted by reports');
    const b = lexicalVector('reports exhausted the connection pool');
    expect(cosine(a, b)).toBeGreaterThan(0.75);
  });
});

describe('cosine', () => {
  it('is 1 for a vector against itself', () => {
    const v = lexicalVector('argon2id password hashing');
    expect(cosine(v, v)).toBeCloseTo(1, 10);
  });

  it('is 0 when either side is the zero vector', () => {
    expect(cosine(lexicalVector('what is it'), lexicalVector('terraform locking'))).toBe(0);
  });

  it('is 0 for vectors of different widths rather than throwing', () => {
    expect(cosine([1, 0, 0], [1, 0])).toBe(0);
  });

  it('is symmetric', () => {
    const a = lexicalVector('rate limited per key with a token bucket');
    const b = lexicalVector('retry storm took the service down');
    expect(cosine(a, b)).toBeCloseTo(cosine(b, a), 12);
  });
});

describe('what the lexical vector space captures', () => {
  it('places a word and its other form close together', () => {
    // The character 4-grams exist for this: `_rota` is shared by both, and a substring LIKE
    // cannot bridge rotating -> rotate at all.
    const query = lexicalVector('rotating the database credentials');
    const target = lexicalVector('database credentials rotate every thirty days');
    expect(cosine(query, target)).toBeGreaterThan(0.3);
  });

  it('ranks a near-duplicate above an unrelated memory', () => {
    const query = lexicalVector('dead letter queue for failed jobs');
    const related = lexicalVector('the job queue retries three times then moves it to a dead letter queue');
    const unrelated = lexicalVector('product images below the fold are lazy-loaded');
    expect(cosine(query, related)).toBeGreaterThan(cosine(query, unrelated));
  });
});

describe('what the lexical vector space does NOT capture', () => {
  it('does not know that dialog and modal mean the same thing', () => {
    // Asserted deliberately. This is the gap a sentence-transformer would close, it is why
    // `semantic` loses to `keyword-scored` on the paraphrase class in
    // docs/evidence/recall-experiment.json, and it is the stated reason the vector path is not
    // the default ranker. If this assertion ever fails, the recall report needs re-reading.
    const query = lexicalVector('keyboard users stuck inside a dialog');
    const target = lexicalVector('the modal keeps focus inside itself');
    expect(cosine(query, target)).toBeLessThan(0.2);
  });

  it('does not connect a paraphrase that shares no vocabulary', () => {
    const query = lexicalVector('people ignore the monitoring because it cries wolf');
    const target = lexicalVector('an alert fires only for a symptom a user would notice');
    expect(cosine(query, target)).toBeLessThan(0.2);
  });
});

describe('LexicalVectorGateway', () => {
  const gw = new LexicalVectorGateway();

  it('is always available, having no model to load', async () => {
    await expect(gw.available()).resolves.toBe(true);
  });

  it('generates the same vector as the free function', async () => {
    await expect(gw.generate('terraform state')).resolves.toEqual(lexicalVector('terraform state'));
  });

  it('generates a batch in the order given', async () => {
    const out = await gw.generateBatch(['alpha token', 'beta token']);
    expect(out).toEqual([lexicalVector('alpha token'), lexicalVector('beta token')]);
  });

  it('exposes cosine through the port', () => {
    const a = lexicalVector('one');
    expect(gw.cosineSimilarity(a, a)).toBeCloseTo(1, 10);
  });

  it('survives the float32 truncation the embedding column imposes', () => {
    // Memories are stored as a Float32 blob and read back (sqlite-memory-repository rowToMemory).
    // A vector that only compares correctly at float64 would score differently in production
    // than in this suite, so the round trip is asserted rather than assumed.
    const v = lexicalVector('a missing index on orders customer id made the dashboard slow');
    const roundTripped = Array.from(new Float32Array(v));
    expect(cosine(v, roundTripped)).toBeGreaterThan(0.9999);
  });
});
