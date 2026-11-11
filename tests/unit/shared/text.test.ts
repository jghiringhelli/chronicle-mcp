import { describe, it, expect } from 'vitest';
import { tokenize, STOP_WORDS } from '../../../src/shared/text.js';

/**
 * One tokenizer, three callers.
 *
 * The SQL candidate filter, the lexical ranker and the vector gateway all call this. If any two
 * of them disagreed about what a word is, a memory could pass the filter and score zero, or
 * score well and never be retrieved — which presents as "recall sometimes misses things" and is
 * close to undebuggable from outside. These tests are what keeps the three honest.
 */
describe('tokenize', () => {
  it('lowercases and splits on anything that is not a letter or digit', () => {
    expect(tokenize('Terraform-State_Lock, DynamoDB!')).toEqual(['terraform', 'state', 'lock', 'dynamodb']);
  });

  it('drops stop words', () => {
    expect(tokenize('what is the capital of France')).toEqual(['capital', 'france']);
  });

  it('keeps negations, because dropping them would make opposites identical', () => {
    // "never logged" and "logged" must not tokenise to the same thing. This is the reason the
    // stop word list is short rather than the usual hundred-plus.
    expect(tokenize('bodies are never logged')).toEqual(['bodies', 'never', 'logged']);
    expect(tokenize('no dump, not ever')).toEqual(['no', 'dump', 'not', 'ever']);
  });

  it('drops single characters, which match every row through LIKE', () => {
    expect(tokenize('a b c retry')).toEqual(['retry']);
  });

  it('keeps digits and alphanumeric tokens', () => {
    expect(tokenize('ISO 4217 and argon2id')).toEqual(['iso', '4217', 'argon2id']);
  });

  it('returns nothing for text made only of stop words', () => {
    // The property the out-of-scope corpus class depends on: a query with no content words can
    // then be answered with nothing at all, instead of with every memory.
    expect(tokenize('what is it that we should do about this')).toEqual([]);
  });

  it('returns nothing for empty or punctuation-only text', () => {
    expect(tokenize('')).toEqual([]);
    expect(tokenize('   ')).toEqual([]);
    expect(tokenize('--- ... !!!')).toEqual([]);
  });

  it('preserves the order of appearance, which bigram features depend on', () => {
    expect(tokenize('dead letter queue')).toEqual(['dead', 'letter', 'queue']);
  });

  it('does not list negations as stop words', () => {
    for (const keep of ['not', 'no', 'never', 'none']) {
      expect(STOP_WORDS.has(keep), `${keep} must not be a stop word`).toBe(false);
    }
  });
});
