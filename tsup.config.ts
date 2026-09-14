import { defineConfig } from 'tsup';

export default defineConfig({
  // Emit uses tsconfig.build.json (src only, rootDir set). The root tsconfig.json is the
  // typecheck config and carries no rootDir — see .claude/ledger.md, Known Pitfalls.
  tsconfig: 'tsconfig.build.json',
  entry: ['src/index.ts', 'src/cli.ts'],
  format: ['esm'],
  dts: true,
  splitting: false,
  sourcemap: true,
  clean: true,
  target: 'node20',
  shims: false,
  // Optional native embedding dep — resolved at runtime from the consumer's
  // node_modules, never bundled. Absence is handled by graceful fallback.
  external: ['fastembed'],
});
