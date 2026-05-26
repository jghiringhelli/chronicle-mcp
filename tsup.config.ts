import { defineConfig } from 'tsup';

export default defineConfig({
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
