import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/cli.ts', 'src/index.ts'],
      // RATCHET, not the target, and the comment is kept in step with the number because it
      // drifted once: this said "42" while the value said 59. Floor history, each one the
      // measurement of the day it was set, rounded down: 15.24% at the first run that could
      // execute at all (the provider could not load before, so the 80 that once sat here was
      // never evaluated) → 41.17% → 42.85% after the v0.4.0 merge → 59.98% on 2026-09-10 →
      // **63.79% on 2026-11-12**, after the ranker, the vector gateway and the contradiction
      // guard arrived with their tests. The TARGET is 80% (.claude/standards/testing.md): raise
      // this toward it as tests land, and never lower it. A threshold nobody can pass is a
      // disabled gate; a floor at the measured value blocks regressions from today forward.
      thresholds: { lines: 63 },
    },
  },
});
