// ESLint flat config — emitted, not described.
//
// Two jobs beyond ordinary hygiene, both of which encode a rule the constitution states
// in prose and could otherwise only be hoped for:
//
//   1. no-cycle        — `.claude/core.md`: "No circular imports (gate-enforced)."
//   2. layer boundary  — `.claude/core.md`: "Domain imports nothing. Services depend on
//                        ports, never adapters." Enforced here as import restrictions, so
//                        a layer violation fails the build instead of passing review.
//
// Run: pnpm run lint

import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import importPlugin from 'eslint-plugin-import';

/** Paths the domain layer is forbidden to reach for. */
const OUTWARD_FROM_DOMAIN = [
  { group: ['**/adapters/**'], message: 'Domain must not import adapters. Dependencies point inward (core.md).' },
  { group: ['**/infrastructure/**'], message: 'Domain must not import infrastructure. Dependencies point inward (core.md).' },
  { group: ['**/services/**'], message: 'Domain must not import services. Dependencies point inward (core.md).' },
  { group: ['**/mcp/**', '**/dashboard/**'], message: 'Domain must not import the delivery layer (core.md).' },
  { group: ['better-sqlite3', 'postgres', '@modelcontextprotocol/*', 'node:*'], message: 'Domain has zero external imports (core.md).' },
];

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'coverage/**', 'reports/**'] },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    files: ['**/*.ts'],
    plugins: { import: importPlugin },
    settings: {
      'import/resolver': { typescript: { project: './tsconfig.json' } },
    },
    rules: {
      // The constitution's acyclicity invariant, made blocking.
      'import/no-cycle': ['error', { maxDepth: Infinity, ignoreExternal: true }],
      'import/no-self-import': 'error',

      // Production-code standards from .claude/standards/architecture.md.
      'max-params': ['error', 5],
      'no-console': 'off', // the CLI and dashboard log to stdout by design
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'warn',
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },

  // Layer boundary: the domain is sealed.
  {
    files: ['src/domain/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', { patterns: OUTWARD_FROM_DOMAIN }],
    },
  },

  // Layer boundary: services depend on ports, never on concrete adapters.
  {
    files: ['src/services/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [{
          group: ['**/adapters/**'],
          message: 'Services depend on ports, never adapters. Inject the concrete class at the composition root (core.md).',
        }],
      }],
    },
  },

  // ── Recorded, expiring waiver ────────────────────────────────────────────────────────────
  //
  // These two files carry 33 `as any[]` casts on SQL row results. They are NOT exempt because
  // the rule is wrong — the rule is right, and `.claude/standards/protocols.md` forbids `any`
  // casts outright. They are exempt because both files have zero tests (522 and 771 lines), and
  // retyping 1,300 uncovered lines before characterising them is the wrong order: RM-102 and
  // RM-103 write the tests first, and the typed row interfaces land with them.
  //
  // Scoped to two paths, so `any` in any new or other file still fails the build. Recorded with
  // an expiry in .forgecraft/exceptions.json (exc-009) — an exemption without an `expires_at` is
  // a bypass, not a waiver.
  {
    files: ['src/services/sync.ts', 'src/services/coordination-service.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },

  // Tests may reach anywhere, and may assert on shapes the production rules forbid.
  {
    files: ['tests/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      'no-restricted-imports': 'off',
    },
  },
);
