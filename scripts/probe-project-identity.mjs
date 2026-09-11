#!/usr/bin/env node
/**
 * Resolve the project identity (ADR-018 §2) for every git repository under a root, and report
 * whether the ids are stable and distinct.
 *
 * This is the measurement the decision rests on: a project id derived from the directory name would
 * fail to join the same repository across two machines that cloned it under different names, and
 * this is how that was established rather than assumed.
 *
 * Usage: node scripts/probe-project-identity.mjs [rootDir]
 */

import { readdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { resolveProjectIdentity } from '../dist/index.js';

const root = process.argv[2] ?? process.cwd();

/** Git repositories at depth 1 and 2 — deep enough for a workspace of grouped repos. */
function findRepos(base) {
  const out = [];
  const visit = (dir, depth) => {
    if (depth > 2) return;
    let entries = [];
    try { entries = readdirSync(dir); } catch { return; }
    if (entries.includes('.git')) { out.push(dir); return; }
    for (const e of entries) {
      if (e.startsWith('.') || e === 'node_modules') continue;
      const p = join(dir, e);
      try { if (statSync(p).isDirectory()) visit(p, depth + 1); } catch { /* unreadable */ }
    }
  };
  visit(base, 0);
  return out;
}

const repos = findRepos(root);
if (repos.length === 0) {
  console.log(`no git repositories found under ${root}`);
  process.exit(0);
}

const rows = repos.map((dir) => {
  const identity = resolveProjectIdentity(dir);
  return { dir: dir.slice(root.length + 1) || '.', ...identity };
});

const widest = Math.max(...rows.map((r) => r.dir.length), 12);
console.log('directory'.padEnd(widest + 2) + 'source'.padEnd(13) + 'project id');
for (const r of rows) {
  console.log(r.dir.padEnd(widest + 2) + r.source.padEnd(13) + r.id);
}

const bySource = rows.reduce((acc, r) => ({ ...acc, [r.source]: (acc[r.source] ?? 0) + 1 }), {});
const ids = rows.map((r) => r.id);
const duplicates = [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))];

console.log(`\nrepositories:        ${rows.length}`);
console.log(`by source:           ${JSON.stringify(bySource)}`);
console.log(`ids distinct:        ${duplicates.length === 0 ? 'yes' : 'NO — ' + duplicates.join(', ')}`);

// A fallback id is not wrong, but it is less stable, so it is worth naming.
const fallbacks = rows.filter((r) => r.source !== 'remote');
if (fallbacks.length) {
  console.log(`\non a fallback (less stable across machines):`);
  for (const f of fallbacks) console.log(`  ${f.dir} -> ${f.id} (${f.source})`);
}

process.exit(duplicates.length === 0 ? 0 : 1);
