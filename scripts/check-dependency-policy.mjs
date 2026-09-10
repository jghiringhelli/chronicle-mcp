#!/usr/bin/env node
/**
 * Enforces docs/dependency-policy.md against package.json.
 *
 * The seven-property rubric does not grade supply-chain safety: a repository can score full
 * marks on every structural property and still ship high-severity CVEs pulled in by an
 * unconstrained dependency chain. So the policy is stated separately — and gated here, so it
 * is enforced rather than advisory.
 *
 * Zero dependencies. Exit 0 = policy holds, 1 = a rule was violated.
 * Pairs with `pnpm audit --prod --audit-level=high` in CI.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));

/** Rule 2 — runtime dependencies are an allow-list, not a free-for-all. */
const APPROVED_RUNTIME = new Set([
  '@modelcontextprotocol/sdk',
  'better-sqlite3',
  'postgres',
  'zod',
]);

/** Rule 3 — forbidden at any version, with the reason the gate prints. */
const FORBIDDEN = {
  'tslint': 'deprecated — use typescript-eslint',
  'jasmine': 'unmaintained for this use — use vitest',
  'request': 'deprecated — use built-in fetch',
  'moment': 'unmaintained and large — use Intl + ISO strings',
  'lodash': 'pulls a large surface for standard-library utilities',
  'prisma': 'rejected in ADR-001 — async driver breaks the <50ms recall contract',
  '@prisma/client': 'rejected in ADR-001',
  'typeorm': 'rejected in ADR-001 — no ORM for a single-user embedded database',
  'sequelize': 'rejected in ADR-001',
  '@typescript-eslint/eslint-plugin': 'use typescript-eslint@^8 (old minimatch CVEs below ^8)',
  '@typescript-eslint/parser': 'use typescript-eslint@^8',
};

/**
 * Rule 7 — native dependencies whose prebuilds are Node-API (ABI-stable across Node majors),
 * so an open-ended `engines.node` is correct for them rather than a lie.
 *
 * Per-ABI native deps are the other case: those need a closed interval naming the majors they
 * publish for. Keep this list short and justified — each entry is a claim that the package ships
 * one binary per platform with no Node version in the filename. Verify before adding:
 *   ls node_modules/<pkg>/prebuilds   → darwin-arm64.node, win32-x64.node, ... (no -node-v137-)
 */
const NAPI_NATIVE = new Set(['better-sqlite3']);

/** Rule 8 — a provider versioned against a host tool must match that host's major. */
const MAJOR_LOCKED_TO = {
  '@vitest/coverage-v8': 'vitest',
  '@vitest/ui': 'vitest',
  '@stryker-mutator/vitest-runner': '@stryker-mutator/core',
};

/** Runtime dependencies that ship a compiled binary. */
const NATIVE_DEPS = new Set(['better-sqlite3']);

const violations = [];
const fail = (rule, detail) => violations.push({ rule, detail });

const runtime = pkg.dependencies ?? {};
const dev = pkg.devDependencies ?? {};
const all = { ...runtime, ...dev };
const major = (range) => {
  const m = /(\d+)\./.exec(String(range));
  return m ? Number(m[1]) : null;
};

// Rule 2 — every runtime dependency is on the approved list.
for (const name of Object.keys(runtime)) {
  if (!APPROVED_RUNTIME.has(name)) {
    fail(2, `runtime dependency "${name}" is not in the Approved Runtime table of docs/dependency-policy.md`);
  }
}

// Rule 3 — nothing forbidden, anywhere.
for (const [name, reason] of Object.entries(FORBIDDEN)) {
  if (name in all) fail(3, `"${name}" is forbidden: ${reason}`);
}
// lodash sub-packages too
for (const name of Object.keys(all)) {
  if (name.startsWith('lodash.')) fail(3, `"${name}" is forbidden: use the standard library`);
}

// Rule 5 — runtime ranges are bounded carets on a real major.
for (const [name, range] of Object.entries(runtime)) {
  if (/^(\*|latest)$/.test(range) || /^>=?/.test(range)) {
    fail(5, `"${name}": "${range}" is unbounded — declare a caret range on a supported major`);
  }
  if (/^(git|github|file|https?):/.test(range) || range.includes('.tgz')) {
    fail(5, `"${name}": "${range}" is not a registry range`);
  }
}

// Rule 6 — the package manager major is pinned.
if (!pkg.packageManager) {
  fail(6, 'package.json has no "packageManager" field — pin the pnpm major');
} else if (!/^pnpm@\d+\./.test(pkg.packageManager)) {
  fail(6, `"packageManager": "${pkg.packageManager}" — this repository is pnpm-only`);
}

// Rule 7 — engines.node must match what the native dependencies can honour.
const engines = pkg.engines?.node;
const perAbiNative = Object.keys(runtime).filter(
  (name) => NATIVE_DEPS.has(name) && !NAPI_NATIVE.has(name),
);
if (!engines) {
  fail(7, 'engines.node is unset');
} else if (perAbiNative.length > 0 && !/<\s*\d/.test(engines)) {
  fail(7, `engines.node "${engines}" is open-ended, but ${perAbiNative.join(', ')} publishes prebuilds per Node ABI — an open range promises support that does not exist. Declare a closed interval naming the majors it builds for (see .claude/ledger.md).`);
} else if (!/>=?\s*\d/.test(engines)) {
  fail(7, `engines.node "${engines}" has no lower bound`);
}

// Rule 8 — majors locked to a host tool.
for (const [name, host] of Object.entries(MAJOR_LOCKED_TO)) {
  if (!(name in all) || !(host in all)) continue;
  const a = major(all[name]);
  const b = major(all[host]);
  if (a !== null && b !== null && a !== b) {
    fail(8, `"${name}"@${all[name]} must match the major of "${host}"@${all[host]} — a mismatch does not fail at install, it fails the first time the gate runs`);
  }
}

if (violations.length === 0) {
  console.log('dependency-policy: ok');
  process.exit(0);
}

console.error('dependency-policy: VIOLATIONS\n');
for (const v of violations) {
  console.error(`  rule ${v.rule}: ${v.detail}`);
}
console.error(`\n${violations.length} violation(s). See docs/dependency-policy.md.`);
process.exit(1);
