import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { SqliteTeamRepository } from '../../../src/adapters/repositories/sqlite-team-repository.js';
import { SCHEMA_SQL } from '../../../src/infrastructure/db/schema.js';
import { toIsoString } from '../../../src/shared/time.js';

/**
 * Regression tests for the team shared-cache search.
 *
 * Found by running the real pull against the real Railway mirror: a memory a teammate shared in May
 * was pulled into the local cache and was still **unfindable**. `searchSharedCache` bound the whole
 * query as ONE `LIKE '%entire string%'`, making it a phrase match — "GS audit SafetyCore" did not
 * match "GS Audit Report completed for SafetyCore Pro", because that exact substring never occurs.
 *
 * Core recall splits on whitespace and ORs per word (EDR-002). The team search now does the same, so
 * the two surfaces behave alike, and these tests hold them together.
 */
describe('SqliteTeamRepository.searchSharedCache', () => {
  let repo: SqliteTeamRepository;
  const TEAM = 'argoscode';

  const share = (id: string, content: string, opts: { tags?: string[]; project?: string; userId?: string; at?: string } = {}) => {
    repo.upsertSharedCache({
      id,
      userId: opts.userId ?? 'gabo',
      teamId: TEAM,
      project: opts.project,
      content,
      memoryType: 'architectural',
      tags: opts.tags ?? [],
      sharedAt: toIsoString(opts.at ?? '2026-05-28T19:23:56.220Z'),
      updatedAt: toIsoString(opts.at ?? '2026-05-28T19:23:56.220Z'),
    });
  };

  beforeEach(() => {
    const db = new Database(':memory:');
    db.exec(SCHEMA_SQL);
    repo = new SqliteTeamRepository(db);
  });

  it('finds a memory by words that are not a contiguous phrase', () => {
    // THE regression. This is the real row, verbatim from the mirror.
    share('mem_1', 'GS Audit Report completed for SafetyCore Pro. Score: 7.5/14 against GS WhitePaper', {
      tags: ['gs-audit', 'harness', 'specification'],
      project: 'SafetyCore',
    });

    const hits = repo.searchSharedCache(TEAM, 'GS audit SafetyCore');

    expect(hits).toHaveLength(1);
    expect(hits[0]?.id).toBe('mem_1');
  });

  it('still finds a memory by an exact phrase', () => {
    share('mem_1', 'GS Audit Report completed for SafetyCore Pro');

    expect(repo.searchSharedCache(TEAM, 'Audit Report completed')).toHaveLength(1);
  });

  it('matches on a single word', () => {
    share('mem_1', 'GS Audit Report completed for SafetyCore Pro');

    expect(repo.searchSharedCache(TEAM, 'SafetyCore')).toHaveLength(1);
  });

  it('matches case-insensitively', () => {
    share('mem_1', 'GS Audit Report for SafetyCore');

    expect(repo.searchSharedCache(TEAM, 'gs audit')).toHaveLength(1);
  });

  it('matches on tags as well as content', () => {
    share('mem_1', 'something entirely unrelated', { tags: ['gs-audit'] });

    expect(repo.searchSharedCache(TEAM, 'gs-audit')).toHaveLength(1);
  });

  it('ORs across words: one matching word is enough', () => {
    // Same semantics as core recall, and the same limitation — relevance does not rise with the
    // number of matched words (ADR-014).
    share('mem_1', 'deployment notes for the gateway');

    expect(repo.searchSharedCache(TEAM, 'gateway quantum unicorn')).toHaveLength(1);
  });

  it('returns nothing when no word matches', () => {
    share('mem_1', 'deployment notes for the gateway');

    expect(repo.searchSharedCache(TEAM, 'xylophone')).toHaveLength(0);
  });

  it('returns the whole team pool for an empty query', () => {
    share('mem_1', 'first');
    share('mem_2', 'second');

    expect(repo.searchSharedCache(TEAM, '')).toHaveLength(2);
    expect(repo.searchSharedCache(TEAM, '   ')).toHaveLength(2);
  });

  it('never leaks another team’s memories', () => {
    share('mem_1', 'shared within argoscode');
    repo.upsertSharedCache({
      id: 'mem_other', userId: 'someone', teamId: 'a-different-team',
      content: 'shared within a different team', memoryType: 'semantic', tags: [],
      sharedAt: toIsoString('2026-05-28'), updatedAt: toIsoString('2026-05-28'),
    });

    const hits = repo.searchSharedCache(TEAM, 'shared');

    expect(hits).toHaveLength(1);
    expect(hits[0]?.teamId).toBe(TEAM);
  });

  it('applies the project filter on top of the word match', () => {
    share('mem_1', 'audit notes', { project: 'SafetyCore' });
    share('mem_2', 'audit notes', { project: 'OtherProject' });

    const hits = repo.searchSharedCache(TEAM, 'audit', 'SafetyCore');

    expect(hits).toHaveLength(1);
    expect(hits[0]?.project).toBe('SafetyCore');
  });

  it('honours the limit', () => {
    for (let i = 0; i < 5; i++) share(`mem_${i}`, `audit note ${i}`);

    expect(repo.searchSharedCache(TEAM, 'audit', undefined, 2)).toHaveLength(2);
  });

  it('orders by recency, which is the only ranking it has', () => {
    share('older', 'audit note', { at: '2026-01-01T00:00:00.000Z' });
    share('newer', 'audit note', { at: '2026-08-01T00:00:00.000Z' });

    expect(repo.searchSharedCache(TEAM, 'audit').map((h) => h.id)).toEqual(['newer', 'older']);
  });

  it('round-trips tags through their JSON column', () => {
    share('mem_1', 'audit note', { tags: ['gs-audit', 'harness'] });

    expect(repo.searchSharedCache(TEAM, 'audit')[0]?.tags).toEqual(['gs-audit', 'harness']);
  });

  it('accepts a Date-shaped timestamp without refusing the bind', () => {
    // The upsert is where "SQLite3 can only bind numbers, strings, bigints, buffers, and null" was
    // thrown, because the pull handed it a Date. Normalising at the boundary is what fixed it.
    const asDate = new Date('2026-05-28T19:23:56.220Z');

    expect(() => repo.upsertSharedCache({
      id: 'mem_date', userId: 'gabo', teamId: TEAM,
      content: 'pulled straight from postgres', memoryType: 'semantic', tags: [],
      sharedAt: toIsoString(asDate), updatedAt: toIsoString(asDate),
    })).not.toThrow();

    expect(repo.searchSharedCache(TEAM, 'postgres')).toHaveLength(1);
  });
});
