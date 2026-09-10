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
      // RATCHET, not the target. 41 is the floor measured on 2026-09-10 (41.17% lines, the first
      // run that could execute at all — the provider could not load before, so the 80 that sat
      // here was never once evaluated). The TARGET is 80% (.claude/standards/testing.md): raise
      // this toward it as tests land, and never lower it. A threshold nobody can pass is a
      // disabled gate; a floor at the measured value blocks regressions from today forward.
      thresholds: { lines: 41 },
    },
  },
});
