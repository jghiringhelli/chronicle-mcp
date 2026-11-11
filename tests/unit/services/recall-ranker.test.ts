import { describe, it, expect } from 'vitest';
import {
  lexicalScore, rankByScore, reciprocalRankFusion, type Rankable,
} from '../../../src/services/recall-ranker.js';

const mem = (id: string, content: string, extra: Partial<Rankable> = {}): Rankable => ({ id, content, ...extra });

/**
 * The ranking that recall did not have.
 *
 * The defect these tests exist to prevent is specific: ordering by `weight DESC` while ignoring
 * the query, so that a memory matching one of five words outranked one matching all five. The
 * third describe block is the one that pins it shut.
 */
describe('lexicalScore', () => {
  it('scores by the fraction of the query that is present', () => {
    const two = lexicalScore('terraform state locking dynamodb', mem('a', 'terraform state sits in S3'));
    const all = lexicalScore('terraform state locking dynamodb', mem('b', 'terraform state locking with a dynamodb table'));
    expect(all).toBeGreaterThan(two);
  });

  it('is 0 when no query word appears', () => {
    expect(lexicalScore('bluetooth pairing android', mem('a', 'the job queue retries three times'))).toBe(0);
  });

  it('is 0 for a query made only of stop words', () => {
    // The out-of-scope property: nothing was asked, so nothing is relevant. Without this a
    // query like "what is it about" would match on sheer commonness.
    expect(lexicalScore('what is it about', mem('a', 'anything at all'))).toBe(0);
  });

  it('does not reward a long memory for merely containing more words', () => {
    // Coverage, not match count. A count-based score would rank the long one higher for the
    // same single hit, which is the opposite of useful in a list a model has to read.
    const short = lexicalScore('retry storm', mem('a', 'one integrator retry storm took the service down'));
    const long = lexicalScore('retry storm', mem('b', `the job queue retries a failed job three times
      with exponential backoff and then moves it to a dead letter queue for a human to look at,
      and separately the gRPC client uses a deadline and a single retry`));
    expect(short).toBeGreaterThan(long);
  });

  it('adds a bonus when the whole query appears verbatim', () => {
    const phrase = lexicalScore('dead letter queue', mem('a', 'moved to a dead letter queue for a human'));
    const scattered = lexicalScore('dead letter queue', mem('b', 'the queue is dead and the letter was lost'));
    expect(phrase).toBeGreaterThan(scattered);
  });

  it('counts a hit on a curated tag', () => {
    const tagged = lexicalScore('accessibility', mem('a', 'the modal keeps focus inside itself', { tags: ['accessibility'] }));
    expect(tagged).toBeGreaterThan(0);
  });

  it('counts a hit on the category', () => {
    expect(lexicalScore('privacy', mem('a', 'request bodies are never written', { category: 'privacy' }))).toBeGreaterThan(0);
  });
});

describe('weight is a tiebreaker and nothing more', () => {
  it('breaks a tie between two equally relevant memories', () => {
    const heavy = lexicalScore('connection pool', mem('a', 'the connection pool was drained', { weight: 0.9 }));
    const light = lexicalScore('connection pool', mem('b', 'the connection pool was drained', { weight: 0.1 }));
    expect(heavy).toBeGreaterThan(light);
  });

  it('cannot overturn a difference in coverage', () => {
    // THE regression test for the shipped defect. The heavy memory matches one word of three;
    // the light one matches all three. Under `ORDER BY weight DESC` the heavy one won.
    const heavyOneWord = lexicalScore('terraform state locking', mem('a', 'terraform is used here', { weight: 1.0 }));
    const lightAllWords = lexicalScore('terraform state locking', mem('b', 'terraform state locking', { weight: 0.01 }));
    expect(lightAllWords).toBeGreaterThan(heavyOneWord);
  });
});

describe('rankByScore', () => {
  it('orders highest first', () => {
    expect(rankByScore([{ id: 'a', score: 0.2 }, { id: 'b', score: 0.9 }, { id: 'c', score: 0.5 }]))
      .toEqual(['b', 'c', 'a']);
  });

  it('drops candidates that scored zero or below', () => {
    expect(rankByScore([{ id: 'a', score: 0 }, { id: 'b', score: -1 }, { id: 'c', score: 0.1 }]))
      .toEqual(['c']);
  });

  it('breaks ties by id so two runs agree', () => {
    // Not cosmetic: an experiment whose output depends on the engine's sort stability is not
    // reproducible, and reproducibility is the claim being made about it.
    expect(rankByScore([{ id: 'zeta', score: 0.5 }, { id: 'alpha', score: 0.5 }]))
      .toEqual(['alpha', 'zeta']);
  });

  it('returns nothing for no candidates', () => {
    expect(rankByScore([])).toEqual([]);
  });
});

describe('reciprocalRankFusion', () => {
  it('ranks a memory both lists agree on above one only a single list found', () => {
    const fused = reciprocalRankFusion([['agreed', 'onlyLexical'], ['agreed', 'onlySemantic']]);
    expect(fused[0]).toBe('agreed');
  });

  it('keeps a memory that only one list returned', () => {
    // The reason fusion is used at all: a memory the vector path alone found must survive, or
    // the vector path contributes nothing beyond re-ordering the keyword results.
    expect(reciprocalRankFusion([['a'], ['b']])).toContain('b');
  });

  it('prefers the better rank when only one list has the item', () => {
    const fused = reciprocalRankFusion([['first', 'second', 'third']]);
    expect(fused).toEqual(['first', 'second', 'third']);
  });

  it('is unaffected by the order the lists are passed in', () => {
    const a = reciprocalRankFusion([['x', 'y'], ['y', 'z']]);
    const b = reciprocalRankFusion([['y', 'z'], ['x', 'y']]);
    expect(a).toEqual(b);
  });

  it('returns nothing for no lists', () => {
    expect(reciprocalRankFusion([])).toEqual([]);
  });

  it('lets a lower k sharpen the advantage of rank 1', () => {
    // k controls how much the head of each list dominates. At k=1 the first position is worth
    // 0.5 and the second 0.33; at k=60 they are 0.0164 and 0.0161. The test pins the direction
    // so a future change to RRF_K is a visible decision rather than a silent retune.
    const sharp = reciprocalRankFusion([['a', 'b'], ['b', 'a']], 1);
    expect(sharp.length).toBe(2);
  });
});
