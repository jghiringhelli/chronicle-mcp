import { describe, it, expect } from 'vitest';
import {
  negationMismatch, preferenceInversion, contradicts,
} from '../../../src/services/contradiction.js';

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

describe('preferenceInversion', () => {
  it('catches the reversal that negation asymmetry cannot see', () => {
    // Neither sentence is asymmetric in negation — both say "avoid" — so `negationMismatch`
    // returns false, and this file previously asserted that miss as the limit of the approach.
    // The meaning is reversed by exchanging which alternative each sentence rejects, which is
    // what this rule reads.
    const a = 'I avoid mocks in tests and prefer a fake.';
    const b = 'I prefer mocks in tests and avoid hand-written fakes.';
    expect(negationMismatch(a, b)).toBe(false);
    expect(preferenceInversion(a, b)).toBe(true);
    expect(contradicts(a, b)).toBe(true);
  });

  it('catches a preference inverted around "rather than"', () => {
    expect(preferenceInversion(
      'Tax is rounded half-up on each line item rather than once on the total.',
      'Tax is rounded half-up once on the total rather than on each line item.',
    )).toBe(true);
  });

  it('does not fire on a restatement that keeps the same preference', () => {
    // Same decision, same rejected alternative, different words. Firing here would withhold a
    // genuine duplicate, and across all 48 restatements in the polarity corpus this rule fires
    // on none of them.
    expect(preferenceInversion(
      'Tax is rounded half-up on each line item rather than once on the total.',
      'Each line item has its tax rounded half-up individually instead of rounding the total once.',
    )).toBe(false);
  });

  it('requires the inversion to cross in BOTH directions', () => {
    // One direction alone is trivial to satisfy — any memory that rejects something the other
    // merely mentions would trip it — and the two-sided test is the entire reason this rule
    // costs nothing. Here the second text rejects nothing, so there is no crossing to find.
    expect(preferenceInversion(
      'Staging runs on synthetic data and never on a production dump.',
      'Staging is refreshed from a production dump every Monday.',
    )).toBe(false);
  });

  it('stops the rejected span at a clause boundary', () => {
    // The regression this guards against is measured, not hypothetical: with a fixed six-word
    // window instead of a clause boundary, "avoid mocks AND PREFER A FAKE" put `fake` on the
    // rejected side of both texts, the two sides overlapped, and the rule scored 0 of 5 on the
    // labelled contradictions. `prefer a fake` must stay on the kept side.
    expect(preferenceInversion(
      'I avoid mocks and prefer a fake.',
      'I prefer mocks and avoid a fake.',
    )).toBe(true);
  });

  it('folds a plural so the two sides of a preference can disagree about number', () => {
    // "prefer a fake" against "avoid fakes" is the real shape of this in a memory store.
    expect(preferenceInversion(
      'I avoid a mock and prefer a fake.',
      'I prefer mocks and avoid fakes.',
    )).toBe(true);
  });

  it('is symmetric', () => {
    const a = 'I avoid mocks in tests and prefer a fake.';
    const b = 'I prefer mocks in tests and avoid hand-written fakes.';
    expect(preferenceInversion(a, b)).toBe(preferenceInversion(b, a));
  });

  it('does not fire on unrelated texts or on empty ones', () => {
    expect(preferenceInversion('', '')).toBe(false);
    expect(preferenceInversion(
      'The NAT gateway was the largest line on the bill.',
      'Plural forms come from Intl.PluralRules.',
    )).toBe(false);
  });
});

describe('contradicts — the function callers use', () => {
  it('fires when either rule fires', () => {
    // Negation only.
    expect(contradicts(
      'Request bodies are never written to the logs.',
      'Request bodies are written to the logs at debug level.',
    )).toBe(true);
    // Inversion only.
    expect(contradicts(
      'I avoid mocks in tests and prefer a fake.',
      'I prefer mocks in tests and avoid hand-written fakes.',
    )).toBe(true);
  });

  it('stays quiet on a genuine restatement', () => {
    expect(contradicts(
      'Releases are blue-green with a five minute soak before traffic moves.',
      'A release brings up a second colour and soaks it for five minutes before shifting traffic.',
    )).toBe(false);
  });
});

describe('what the guard cannot see', () => {

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

  it('misses a reversal carried by substituting an antonym with no contrast marker', () => {
    // The remaining limit, asserted so it cannot change unnoticed. Nothing is negated and
    // nothing is marked as rejected: the claim is reversed by swapping "integer cents" for
    // "floating point doubles", which needs lexical knowledge this module does not have. It is
    // 13 of the 48 reversals in the polarity corpus, and the report says so.
    const a = 'Monetary amounts are stored as integer cents everywhere.';
    const b = 'Monetary amounts are stored as floating point doubles everywhere.';
    expect(negationMismatch(a, b)).toBe(false);
    expect(preferenceInversion(a, b)).toBe(false);
    expect(contradicts(a, b)).toBe(false);
  });
});
