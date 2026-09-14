#!/usr/bin/env node
/**
 * Refuse to publish a release that contradicts itself.
 *
 * `npm publish` will happily ship whatever is lying in `dist/`, with a manifest that names a
 * different version and a changelog that never mentions it. That is not hypothetical here: `0.4.0`
 * went to the registry with no CHANGELOG entry at all, and `server.json` sat at `0.3.2` for two
 * releases — so the MCP Registry manifest described a package version that was two behind what npm
 * was serving.
 *
 * Zero dependencies, runs before `gates` in `prepublishOnly`. Exit 0 = coherent, 1 = do not publish.
 *
 * Usage: node scripts/check-release.mjs
 */

import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const read = (f) => readFileSync(join(ROOT, f), 'utf8');
const pkg = JSON.parse(read('package.json'));

const problems = [];
const fail = (what, detail) => problems.push({ what, detail });
const ok = (what) => console.log(`  ok    ${what}`);

const VERSION = pkg.version;
console.log(`release check for ${pkg.name}@${VERSION}\n`);

// ── The manifest must describe the package actually being published ────────────────────────
if (existsSync(join(ROOT, 'server.json'))) {
  const server = JSON.parse(read('server.json'));
  const versions = [server.version, ...(server.packages ?? []).map((p) => p.version)];
  const wrong = versions.filter((v) => v !== VERSION);
  if (wrong.length > 0) {
    fail('server.json version', `declares ${[...new Set(wrong)].join(', ')} but package.json is ${VERSION}. ` +
      'The MCP Registry reads this file; a stale version points the registry at the wrong release.');
  } else ok(`server.json declares ${VERSION}`);
} else {
  fail('server.json', 'missing, but package.json lists it in "files" — the tarball would be short a file');
}

// ── Every file promised in the tarball must exist ──────────────────────────────────────────
const missing = (pkg.files ?? []).filter((f) => !existsSync(join(ROOT, f)));
if (missing.length > 0) fail('files[]', `declared but absent: ${missing.join(', ')}`);
else ok(`all ${(pkg.files ?? []).length} entries in files[] exist`);

// ── A release nobody wrote down is not a release ───────────────────────────────────────────
const changelog = read('CHANGELOG.md');
if (!changelog.includes(`## [${VERSION}]`)) {
  fail('CHANGELOG.md', `has no "## [${VERSION}]" section. 0.4.0 shipped this way and there is now a ` +
    'permanent hole in the record — the registry has a version the project never described.');
} else ok(`CHANGELOG.md documents ${VERSION}`);

// ── The build must be present and newer than the sources it claims to be built from ────────
const entry = join(ROOT, 'dist', 'cli.js');
if (!existsSync(entry)) {
  fail('dist/cli.js', 'absent — run the build. `npm publish` does not build for you.');
} else {
  // Deliberately a warning-shaped check rather than a hash: `prepublishOnly` runs the build anyway,
  // so this catches the case where someone publishes past it (`--ignore-scripts`, or a stale CI step).
  const { mtimeMs } = statSync(entry);
  const newestSrc = newestMtime(join(ROOT, 'src'));
  if (newestSrc > mtimeMs) {
    fail('dist is stale', 'a file under src/ is newer than dist/cli.js. The tarball would ship code ' +
      'that does not match this commit.');
  } else ok('dist/cli.js is newer than every file in src/');
}

// ── This version must not already be on the registry ───────────────────────────────────────
//
// The three outcomes are different and must not be collapsed. "npm says this version exists" is a
// refusal; "npm says it does not" is a pass; "npm could not be run" is neither, and reporting it as
// a pass is how a check becomes decoration. The first draft did exactly that: on Windows `npm` is
// `npm.cmd`, execFileSync raised ENOENT, and the catch cheerfully printed "0.4.0 is not on the
// registry yet" about a version that had been published for days.
// On Windows npm is a `.cmd`, and since the fix for CVE-2024-27980 Node refuses to execute one
// without a shell. Both details are needed, and `shell: true` is safe here only because every
// argument comes from this repository's own package.json, not from input.
const isWindows = process.platform === 'win32';
let registryAnswer;
try {
  registryAnswer = execFileSync(isWindows ? 'npm.cmd' : 'npm',
    ['view', `${pkg.name}@${VERSION}`, 'version'],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60_000, shell: isWindows }).trim();
} catch (err) {
  // npm exits non-zero both for "no such version" and for "could not reach the registry"; the
  // stderr text is the only thing separating them.
  const stderr = String(err?.stderr ?? '');
  registryAnswer = /E404|is not in this registry|No match/i.test(stderr) ? '' : null;
}

if (registryAnswer === null) {
  fail('registry check', `could not ask npm whether ${VERSION} exists (is npm on PATH, and online?). ` +
    `Not treating that as a pass — run \`npm view ${pkg.name}@${VERSION} version\` by hand.`);
} else if (registryAnswer === VERSION) {
  fail('already published', `${pkg.name}@${VERSION} is on the registry. Bump the version — npm will ` +
    'reject the publish anyway, but later and with a worse message.');
} else {
  ok(`${VERSION} is not on the registry yet`);
}

// ── The engines claim must still hold, since it is the breaking part of this release ───────
try {
  execFileSync(process.execPath, [join(ROOT, 'scripts', 'check-dependency-policy.mjs')],
    { stdio: ['ignore', 'ignore', 'pipe'] });
  ok('dependency policy holds (engines floor included, rule 9)');
} catch {
  fail('dependency policy', 'check-dependency-policy.mjs fails — run it to see which rule');
}

function newestMtime(dir) {
  let newest = 0;
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const full = join(d, e.name);
      if (e.isDirectory()) walk(full);
      else newest = Math.max(newest, statSync(full).mtimeMs);
    }
  };
  walk(dir);
  return newest;
}

if (problems.length === 0) {
  console.log(`\nrelease-check: ok — ${pkg.name}@${VERSION} is coherent`);
  process.exit(0);
}

console.error('\nrelease-check: DO NOT PUBLISH\n');
for (const p of problems) console.error(`  ${p.what}: ${p.detail}`);
console.error(`\n${problems.length} problem(s).`);
process.exit(1);
