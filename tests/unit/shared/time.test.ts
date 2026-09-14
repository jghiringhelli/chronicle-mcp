import { describe, it, expect } from 'vitest';
import { toIsoString, toTagsJson } from '../../../src/shared/time.js';

/**
 * Regression tests for the Postgres → SQLite boundary (EDR-003 invariant 4).
 *
 * These exist because of a defect no unit test could have caught: the cloud pull cast
 * `timestamptz` columns `as string`, but `postgres.js` returns a JavaScript **Date**. better-sqlite3
 * refused the bind — *"SQLite3 can only bind numbers, strings, bigints, buffers, and null"* — so
 * `team sync` failed against the real database while the whole suite passed, because the suite's
 * fake `sql` client hands back strings.
 *
 * The lesson is in `.claude/ledger.md`: a test double that is more convenient than reality tests
 * the double.
 */
describe('toIsoString', () => {
  it('converts the Date a Postgres driver returns into an ISO string', () => {
    // THE case. A Date here is what broke the pull.
    const d = new Date('2026-05-28T19:23:56.220Z');

    expect(toIsoString(d)).toBe('2026-05-28T19:23:56.220Z');
    expect(typeof toIsoString(d)).toBe('string');
  });

  it('leaves an already-ISO string at the same instant', () => {
    expect(toIsoString('2026-05-28T19:23:56.220Z')).toBe('2026-05-28T19:23:56.220Z');
  });

  it('normalises a non-ISO date string into the comparable form', () => {
    // The conflict policy compares these lexicographically, so one spelling is the whole point.
    expect(toIsoString('2026-05-28')).toBe('2026-05-28T00:00:00.000Z');
  });

  it('accepts epoch milliseconds', () => {
    expect(toIsoString(Date.UTC(2026, 4, 28))).toBe('2026-05-28T00:00:00.000Z');
  });

  it('falls back rather than throwing on an invalid Date', () => {
    // A malformed timestamp on one pulled row must not abort a whole sync pass.
    expect(toIsoString(new Date('not a date'), '1970-01-01T00:00:00.000Z'))
      .toBe('1970-01-01T00:00:00.000Z');
  });

  it('falls back rather than throwing on unparseable text', () => {
    expect(toIsoString('banana', '1970-01-01T00:00:00.000Z')).toBe('1970-01-01T00:00:00.000Z');
  });

  it('falls back for null, undefined and empty string', () => {
    const f = '1970-01-01T00:00:00.000Z';
    expect(toIsoString(null, f)).toBe(f);
    expect(toIsoString(undefined, f)).toBe(f);
    expect(toIsoString('', f)).toBe(f);
  });

  it('defaults the fallback to now, so a row always carries a usable timestamp', () => {
    const before = Date.now();
    const out = toIsoString(null);
    expect(Date.parse(out)).toBeGreaterThanOrEqual(before);
  });

  it('produces output that sorts chronologically as a plain string', () => {
    // EDR-003 compares timestamps with `>=` on strings. That is only correct while every writer
    // emits this exact format.
    const early = toIsoString(new Date('2026-01-02T03:04:05.006Z'));
    const late = toIsoString(new Date('2026-11-02T03:04:05.006Z'));

    expect(early < late).toBe(true);
    expect([late, early].sort()).toEqual([early, late]);
  });
});

describe('toTagsJson', () => {
  it('serialises the array a Postgres text[] column returns', () => {
    // Arrays are the other shape SQLite cannot bind.
    expect(toTagsJson(['gs-audit', 'harness'])).toBe('["gs-audit","harness"]');
  });

  it('passes an already-serialised JSON array through unchanged', () => {
    expect(toTagsJson('["a","b"]')).toBe('["a","b"]');
  });

  it('returns an empty array for null, undefined and a non-array value', () => {
    // The tags column has a '[]' default and is never NULL (EDR-002 invariant 2).
    expect(toTagsJson(null)).toBe('[]');
    expect(toTagsJson(undefined)).toBe('[]');
    expect(toTagsJson('not json')).toBe('[]');
    expect(toTagsJson(42)).toBe('[]');
  });

  it('coerces non-string array members rather than emitting them raw', () => {
    expect(toTagsJson([1, true])).toBe('["1","true"]');
  });

  it('always returns something SQLite can bind', () => {
    for (const input of [['a'], '["a"]', null, undefined, 42, {}, new Date()]) {
      expect(typeof toTagsJson(input)).toBe('string');
    }
  });
});
