import { describe, it, expect } from 'vitest';
import { negationMismatch } from '../../../src/services/contradiction.js';

/**
 * The guard that stops de-duplication deleting a policy.
 *
 * It exists because of a measurement, not a hunch: over the labelled pairs in
 * `experiments/dedup`, the two most similar pairs in the whole corpus were contradictions, both
 * scoring above every genuine duplicate. The last describe block asserts the guard's limit as
 * carefully as its behaviour, because that limit is published in the report.
 */
describe('negationMismatch', () => {
  it('fires when one side negates and the other does not', () => {
    expect(negationMismatch(
      'Request bodies are never written to the logs.',
      'Request bodies are written to the logs at debug level.',
    )).toBe(true);
  });

  it('does not fire when neither side negates', () => {
    expect(negationMismatch(
      'Releases are blue-green with a soak.',
      'We deploy blue-green and let the new colour soak.',
    )).toBe(false);
  });

  it('does not fire when both sides negate', () => {
    // Agreement, not contradiction. Two memories that both forbid something are candidates for
    // merging like any other pair.
    expect(negationMismatch(
      'Staging never runs on a production dump.',
      'We do not refresh staging from production.',
    )).toBe(false);
  });

  it('treats a contraction the same as the written-out form', () => {
    // A tokenizer that splits on non-letters turns "don't" into "don" and "t", and "t" is below
    // every length floor — so without expansion the negation would vanish completely.
    expect(negationMismatch("We don't deploy on Friday.", 'We deploy on Friday.')).toBe(true);
    expect(negationMismatch("We don't deploy on Friday.", 'We do not deploy on Friday.')).toBe(false);
  });

  it('recognises the negations that matter in a technical memory', () => {
    for (const negated of [
      'the operation is forbidden',
      'this is prohibited here',
      'we avoid mocks',
      'it runs without a lock',
      'none of the rows are touched',
      'it cannot be retried',
    ]) {
      expect(negationMismatch(negated, 'the operation runs'), negated).toBe(true);
    }
  });

  it('ignores hedges, which narrow a claim rather than reverse it', () => {
    // "We rarely deploy on Friday" should still be able to merge with "we do not deploy on
    // Friday"; treating a hedge as a contradiction would block a merge that ought to happen.
    expect(negationMismatch('We rarely deploy on Friday.', 'We sometimes deploy on Friday.')).toBe(false);
  });

  it('is symmetric', () => {
    const a = 'bodies are never logged';
    const b = 'bodies are logged';
    expect(negationMismatch(a, b)).toBe(negationMismatch(b, a));
  });

  it('does not fire on two empty texts', () => {
    expect(negationMismatch('', '')).toBe(false);
  });
});

describe('what the guard cannot see', () => {
  it('misses a reversal carried by swapping two verbs', () => {
    // The honest limit, asserted so it cannot change unnoticed: neither sentence contains a
    // negation, so nothing is asymmetric — the meaning is reversed by exchanging "avoid" and
    // "prefer". This is the one labelled contradiction the guard does not catch, and the report
    // says so. Catching it needs to parse the sentence rather than scan it.
    expect(negationMismatch(
      'I avoid mocks in tests and prefer a fake.',
      'I prefer mocks in tests and avoid hand-written fakes.',
    )).toBe(false);
  });

  it('fires on a negation that sits in the rationale rather than the claim', () => {
    // A false positive of the guard, and the reason it costs three genuine duplicates out of
    // eleven: the negation here qualifies WHY, not WHAT, but the guard reads the whole memory.
    // Accepted because the guard can only prevent a merge, and a near-duplicate left in the pool
    // is visible where a withheld memory is not.
    expect(negationMismatch(
      'Send an idempotency key so a retry cannot bill twice.',
      'We send an idempotency key derived from the order, otherwise a retry double-charges.',
    )).toBe(true);
  });
});
