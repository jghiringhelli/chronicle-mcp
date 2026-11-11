import { describe, it, expect } from 'vitest';
import { FirstAvailableEmbeddingGateway } from '../../../src/infrastructure/gateways/first-available-embedding-gateway.js';
import type { EmbeddingGateway } from '../../../src/ports/gateways/embedding-gateway.js';
import type { Embedding } from '../../../src/domain/types.js';

/**
 * A fake gateway that records how often it was probed.
 *
 * A stub rather than a mock: the tests assert on the vector that comes back and on the probe
 * count, not on a pre-programmed call pattern.
 */
function fake(id: string, available: boolean, opts: { throws?: boolean } = {}): EmbeddingGateway & { probes: number } {
  const gw = {
    probes: 0,
    async available(): Promise<boolean> {
      gw.probes++;
      if (opts.throws) throw new Error('probe exploded');
      return available;
    },
    async generate(): Promise<Embedding> { return [id.length, 0, 0]; },
    async generateBatch(texts: string[]): Promise<Embedding[]> { return texts.map(() => [id.length, 0, 0]); },
    cosineSimilarity(): number { return id.length; },
  };
  return gw;
}

describe('FirstAvailableEmbeddingGateway', () => {
  it('uses the first available candidate', async () => {
    const gw = new FirstAvailableEmbeddingGateway([fake('no', false), fake('yes', true)]);
    await expect(gw.generate('x')).resolves.toEqual([3, 0, 0]);
  });

  it('prefers an earlier candidate over a later one', async () => {
    // The preference order is the point: fastembed first when the user installed it, the
    // dependency-free vectors otherwise (ADR-017 kept that upgrade open).
    const gw = new FirstAvailableEmbeddingGateway([fake('first', true), fake('second', true)]);
    await expect(gw.generate('x')).resolves.toEqual([5, 0, 0]);
  });

  it('reports unavailable when no candidate is', async () => {
    const gw = new FirstAvailableEmbeddingGateway([fake('a', false), fake('b', false)]);
    await expect(gw.available()).resolves.toBe(false);
  });

  it('reports unavailable for an empty candidate list', async () => {
    await expect(new FirstAvailableEmbeddingGateway([]).available()).resolves.toBe(false);
  });

  it('skips a candidate whose probe throws instead of failing the call', async () => {
    // The port forbids `available()` from throwing. A gateway that breaks that contract should
    // cost the feature, not the process — promote would otherwise die on a bad optional install.
    const bad = fake('bad', true, { throws: true });
    const good = fake('ok', true);
    const gw = new FirstAvailableEmbeddingGateway([bad, good]);
    await expect(gw.generate('x')).resolves.toEqual([2, 0, 0]);
  });

  it('probes only once however many calls are made', async () => {
    // Re-probing would mean an `await import('fastembed')` per promote, and a gateway whose
    // answer changed mid-session would judge two memories in two different vector spaces.
    const only = fake('one', true);
    const gw = new FirstAvailableEmbeddingGateway([only]);
    await gw.available();
    await gw.generate('a');
    await gw.generateBatch(['b', 'c']);
    expect(only.probes).toBe(1);
  });

  it('throws a named error when asked to embed with nothing available', async () => {
    const gw = new FirstAvailableEmbeddingGateway([fake('a', false)]);
    await expect(gw.generate('x')).rejects.toThrow(/No embedding gateway is available/);
  });

  it('delegates cosine to the chosen gateway once one is chosen', async () => {
    const gw = new FirstAvailableEmbeddingGateway([fake('no', false), fake('chosen', true)]);
    await gw.available();
    expect(gw.cosineSimilarity([1], [1])).toBe('chosen'.length);
  });

  it('returns 0 from cosine when there are no candidates at all', () => {
    expect(new FirstAvailableEmbeddingGateway([]).cosineSimilarity([1], [1])).toBe(0);
  });

  it('batches through the chosen gateway in order', async () => {
    const gw = new FirstAvailableEmbeddingGateway([fake('abcd', true)]);
    await expect(gw.generateBatch(['x', 'y'])).resolves.toEqual([[4, 0, 0], [4, 0, 0]]);
  });

  it('does not probe at construction time', () => {
    // Construction happens at the composition root, where nothing may await. A gateway that
    // probed in its constructor would fire an optional dynamic import during server startup.
    const candidate = fake('lazy', true);
    new FirstAvailableEmbeddingGateway([candidate]);
    expect(candidate.probes).toBe(0);
  });
});

describe('the real composition', () => {
  it('falls back to the lexical vectors when fastembed is absent', async () => {
    // What a default install gets. fastembed is not in the install tree (ADR-017), so this is
    // the path every user takes unless they installed it themselves.
    const { FastEmbedGateway } = await import('../../../src/infrastructure/gateways/fastembed-gateway.js');
    const { LexicalVectorGateway, lexicalVector } = await import('../../../src/infrastructure/gateways/lexical-vector-gateway.js');
    const gw = new FirstAvailableEmbeddingGateway([new FastEmbedGateway(), new LexicalVectorGateway()]);

    await expect(gw.available()).resolves.toBe(true);
    const vector = await gw.generate('terraform state locking');
    // If fastembed IS installed on this machine the vector is the model's, which is a different
    // width — so the assertion names both acceptable outcomes rather than silently passing on
    // whichever one happened.
    const lexical = lexicalVector('terraform state locking');
    const isLexical = vector.length === lexical.length;
    expect(isLexical || vector.length === 384, `unexpected vector width ${vector.length}`).toBe(true);
    if (isLexical) expect(vector).toEqual(lexical);
    else console.warn('  NOTE: fastembed is installed here, so the model path was exercised instead.');
  });
});
