/**
 * Unit tests for FastEmbedGateway.cosineSimilarity (pure math; no model load).
 */
import { describe, it, expect } from 'vitest';
import { FastEmbedGateway } from '../../../src/infrastructure/gateways/fastembed-gateway.js';

describe('FastEmbedGateway.cosineSimilarity', () => {
  const g = new FastEmbedGateway();

  it('scores identical vectors as 1', () => {
    expect(g.cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1);
  });

  it('scores orthogonal vectors as 0', () => {
    expect(g.cosineSimilarity([1, 0], [0, 1])).toBe(0);
  });

  it('scores opposite vectors as -1', () => {
    expect(g.cosineSimilarity([1, 1], [-1, -1])).toBeCloseTo(-1);
  });

  it('returns 0 for mismatched lengths', () => {
    expect(g.cosineSimilarity([1, 2, 3], [1, 2])).toBe(0);
  });

  it('returns 0 when either vector is empty or all-zero', () => {
    expect(g.cosineSimilarity([], [])).toBe(0);
    expect(g.cosineSimilarity([0, 0], [1, 1])).toBe(0);
  });
});
