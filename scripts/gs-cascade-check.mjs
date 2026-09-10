#!/usr/bin/env node
/**
 * GS cascade check — the five-step cascade of Generative Specification,
 * expressed as machine-evaluable predicates rather than a human checklist.
 *
 * Reference: generative-specification/docs/repository-discipline.md §7
 * Rubric refinement R7 ("predicates over checklists"): a gate expressed as a
 * checklist does not score; a gate expressed as a predicate does.
 *
 * Zero dependencies — runs on a bare Node 20+ with no install step, so it is
 * usable from a pre-commit hook and from CI before `install` has run.
 *
 * Exit codes: 0 = all predicates hold · 1 = at least one ERROR predicate failed.
 * Warnings never fail the build; they are the severity ramp's `warning` tier
 * (repository-discipline.md §9).
 *
 * Usage: node scripts/gs-cascade-check.mjs [--json]
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative, posix } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const JSON_OUT = process.argv.includes('--json');

/** Read budget for a single artifact, in lines. A file past this is silently
 *  truncated by the agent's read tool, which makes it equivalent to absent. */
const READ_BUDGET_LINES = 300;

/** The five categories a sentinel tree must collectively cover (Bounded). */
const REQUIRED_CATEGORIES = [
  'architectural-identity',
  'standards',
  'constraints',
  'tool-sequencing',
  'routing',
];

/** Closed key set for harness-document frontmatter (GS_Rubric_ScoringGuide). */
const FRONTMATTER_KEYS = new Set([
  'id', 'type', 'status', 'tier', 'properties', 'obligations',
  'generative_execution', 'depends_on',
  // sentinel-node routing keys
  'node', 'scope', 'load', 'categories', 'routes_to',
]);

const TYPE_ENUM = new Set([
  'constitution', 'sentinel-node', 'spec-section', 'use-case', 'adr',
  'edr', 'gate', 'pattern', 'status',
]);
const STATUS_ENUM = new Set(['draft', 'active', 'superseded', 'archived']);
const LOAD_ENUM = new Set(['always', 'on-demand']);
const EXECUTION_ENUM = new Set(['green', 'red', 'unrun']);
const PROPERTY_VOCAB = new Set([
  'self-describing', 'bounded', 'verifiable', 'defended',
  'auditable', 'composable', 'executable',
]);

const findings = [];
const record = (severity, step, predicate, detail) =>
  findings.push({ severity, step, predicate, detail });
const error = (...a) => record('error', ...a);
const warn = (...a) => record('warning', ...a);

// ── helpers ───────────────────────────────────────────────────────────────────

const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const has = (p) => existsSync(join(ROOT, p));
const lineCount = (text) => text.split(/\r?\n/).length;

function walk(dir, pattern = /\.md$/) {
  const abs = join(ROOT, dir);
  if (!existsSync(abs)) return [];
  const out = [];
  for (const entry of readdirSync(abs)) {
    const rel = posix.join(dir, entry);
    if (statSync(join(ROOT, rel)).isDirectory()) out.push(...walk(rel, pattern));
    else if (pattern.test(entry)) out.push(rel);
  }
  return out;
}

/**
 * Minimal YAML frontmatter reader. Supports the flat scalar and inline-list
 * shapes the frontmatter schema uses — deliberately not a YAML parser, because
 * the schema's key set is closed and its values are scalars or inline lists.
 */
function frontmatter(text) {
  if (!text.startsWith('---')) return null;
  const end = text.indexOf('\n---', 3);
  if (end === -1) return null;
  const body = text.slice(3, end);
  if (/^\s*\w+:\s*$/m.test(body)) return null; // nested block → not this schema
  const out = {};
  for (const line of body.split(/\r?\n/)) {
    const m = /^([a-z_]+):\s*(.*)$/.exec(line.trim());
    if (!m) continue;
    const [, key, raw] = m;
    out[key] = raw.startsWith('[')
      ? raw.replace(/^\[|\]$/g, '').split(',').map((s) => s.trim()).filter(Boolean)
      : raw.replace(/^["']|["']$/g, '').trim();
  }
  return out;
}

/** Exemptions recorded in .forgecraft/exceptions.json, keyed by `hook` + path. */
function exemptions() {
  if (!has('.forgecraft/exceptions.json')) return [];
  try {
    return JSON.parse(read('.forgecraft/exceptions.json')).exceptions ?? [];
  } catch {
    warn(0, 'exceptions-parse', '.forgecraft/exceptions.json is not valid JSON');
    return [];
  }
}
const EXEMPT = exemptions();
const isExempt = (hook, path) =>
  EXEMPT.some((e) => e.hook === hook && e.pattern === path);

// ── Step 0 — the root sentinel exists and is the only always-loaded node ──────

function stepSentinelRoot() {
  if (!has('CLAUDE.md')) {
    error(1, 'sentinel-root-exists', 'CLAUDE.md is absent — the tree has no door');
    return;
  }
  const root = read('CLAUDE.md');
  if (lineCount(root) > READ_BUDGET_LINES) {
    error(1, 'sentinel-root-within-budget',
      `CLAUDE.md is ${lineCount(root)} lines (budget ${READ_BUDGET_LINES})`);
  }
  if (!has('.claude/index.md')) {
    error(1, 'router-exists', '.claude/index.md is absent — the root routes nowhere');
  }
}

// ── Step 1 — the sentinel tree is complete, connected and within budget ──────

function stepSentinelTree() {
  const nodes = walk('.claude').filter((p) => !p.includes('/commands/'));
  const covered = new Set();
  const declared = new Map(); // node name → relative path

  for (const path of nodes) {
    const text = read(path);
    const fm = frontmatter(text);

    if (lineCount(text) > READ_BUDGET_LINES && !isExempt('audit/cnt_leaf_length', path)) {
      error(1, 'node-within-read-budget',
        `${path} is ${lineCount(text)} lines (budget ${READ_BUDGET_LINES}) and carries no recorded exemption`);
    }
    if (/\{\{[a-z_]+\}\}/.test(text)) {
      const holes = [...text.matchAll(/\{\{([a-z_]+)\}\}/g)].map((m) => m[1]);
      error(1, 'no-unresolved-placeholders',
        `${path} still carries template placeholders: ${[...new Set(holes)].join(', ')}`);
    }
    if (!fm) {
      warn(1, 'node-carries-frontmatter',
        `${path} has no sentinel-node frontmatter — the router must infer its scope from prose`);
      continue;
    }
    if (fm.node) declared.set(fm.node, path);
    for (const c of fm.categories ?? []) {
      if (!REQUIRED_CATEGORIES.includes(c)) {
        error(1, 'category-vocabulary-closed',
          `${path} declares unknown category "${c}"`);
      }
      covered.add(c);
    }
    if (fm.load && !LOAD_ENUM.has(fm.load)) {
      error(1, 'load-enum-closed', `${path} declares load: ${fm.load}`);
    }
  }

  for (const c of REQUIRED_CATEGORIES) {
    if (!covered.has(c)) {
      error(1, 'five-categories-collectively-present',
        `no sentinel node declares category "${c}" — sessions will drift in that dimension`);
    }
  }

  // routes_to must resolve to a declared node
  for (const path of nodes) {
    const fm = frontmatter(read(path));
    for (const target of fm?.routes_to ?? []) {
      if (!declared.has(target)) {
        error(1, 'routes-resolve',
          `${path} routes to "${target}", which no node declares`);
      }
    }
  }

  // every @reference in the router must point at a file that exists
  if (has('.claude/index.md')) {
    for (const m of read('.claude/index.md').matchAll(/@([\w./-]+\.md)/g)) {
      if (!has(m[1])) {
        error(1, 'router-references-resolve',
          `.claude/index.md routes to ${m[1]}, which does not exist`);
      }
    }
  }
}

// ── Step 2 — spec / ADR alignment ────────────────────────────────────────────

const ADR_SECTIONS = ['Context', 'Decision', 'Consequences'];

function stepSpecAdr() {
  const adrs = walk('docs/adrs').filter((p) => /ADR-\d+/.test(p));
  if (adrs.length === 0) {
    error(2, 'adr-corpus-nonempty', 'no ADR files under docs/adrs/');
    return;
  }
  for (const path of adrs) {
    const text = read(path);
    for (const section of ADR_SECTIONS) {
      if (!new RegExp(`^#+\\s*${section}`, 'im').test(text)) {
        error(2, 'adr-has-required-sections', `${path} has no "${section}" section`);
      }
    }
    if (!/^\*{0,2}Status/im.test(text) && !frontmatter(text)?.status) {
      error(2, 'adr-declares-status', `${path} declares no status`);
    }
    const superseded = /supersede[sd] by ADR-(\d+)/i.exec(text);
    if (superseded && !adrs.some((p) => p.includes(`ADR-${superseded[1]}`))) {
      error(2, 'supersession-resolves',
        `${path} is superseded by ADR-${superseded[1]}, which does not exist`);
    }
  }

  // the ADR index must list every ADR file, and every listed ADR must exist
  const indexPath = '.claude/adr/index.md';
  if (has(indexPath)) {
    const index = read(indexPath);
    for (const path of adrs) {
      const id = /ADR-(\d+)/.exec(path)[1];
      if (!new RegExp(`ADR-0*${Number(id)}\\b`).test(index)) {
        error(2, 'adr-index-complete', `${path} is not listed in ${indexPath}`);
      }
    }
    for (const m of index.matchAll(/@([\w./-]+\.md)/g)) {
      if (!has(m[1])) {
        error(2, 'adr-index-references-resolve',
          `${indexPath} points at ${m[1]}, which does not exist`);
      }
    }
  }
}

// ── Step 3 — no stub artifact occupies a required cascade slot ────────────────

const STUB_MARKERS = [
  /\bMy Project\b/,
  /\[(TBD|requirement|placeholder)\]/i,
  /\[Why this project exists/,
  /\[One paragraph translating/,
];

function stepNoStubs() {
  const required = cascadeRequiredArtifacts();
  for (const path of required) {
    if (!has(path)) {
      error(3, 'cascade-artifact-exists',
        `${path} is declared required by forgecraft.yaml but does not exist`);
      continue;
    }
    // A required slot may be a directory (the ADR corpus). Existence is the whole predicate
    // there — its contents are checked by step 2.
    if (statSync(join(ROOT, path)).isDirectory()) {
      if (readdirSync(join(ROOT, path)).filter((f) => f !== 'README.md').length === 0) {
        error(3, 'cascade-artifact-not-a-stub',
          `${path} is a required cascade slot and holds nothing but a scaffold README`);
      }
      continue;
    }
    const text = read(path);
    const hit = STUB_MARKERS.find((re) => re.test(text));
    if (hit) {
      error(3, 'cascade-artifact-not-a-stub',
        `${path} occupies a required cascade slot but is still an unfilled template (matched ${hit})`);
    }
  }
}

function cascadeRequiredArtifacts() {
  // forgecraft.yaml is the declaration of which cascade steps are required.
  // Parsed narrowly: we only need the step names marked `required: true`.
  if (!has('forgecraft.yaml')) return [];
  const text = read('forgecraft.yaml');
  const map = {
    functional_spec: 'docs/PRD.md',
    constitution: 'CLAUDE.md',
    behavioral_contracts: 'docs/use-cases.md',
    architecture_diagrams: 'docs/diagrams/c4-context.md',
    adrs: 'docs/adrs/active',
  };
  const out = [];
  const stepRe = /- step:\s*(\w+)[\s\S]*?required:\s*(true|false)/g;
  for (const m of text.matchAll(stepRe)) {
    if (m[2] === 'true' && map[m[1]]) out.push(map[m[1]]);
  }
  return out;
}

// ── Step 4 — no orphan references anywhere in the doc corpus ─────────────────

function stepNoOrphanReferences() {
  for (const path of walk('docs')) {
    const text = read(path);
    // markdown links and bare backticked paths that look like repo paths
    const candidates = new Set();
    for (const m of text.matchAll(/\]\((?!https?:|#|mailto:)([^)\s#]+)\)/g)) candidates.add(m[1]);
    for (const m of text.matchAll(/`((?:docs|src|tests|scripts|\.claude|\.github)\/[\w./-]+\.\w+)`/g)) {
      candidates.add(m[1]);
    }
    for (const ref of candidates) {
      const target = ref.startsWith('docs/') || ref.startsWith('src/') ||
        ref.startsWith('tests/') || ref.startsWith('scripts/') ||
        ref.startsWith('.claude/') || ref.startsWith('.github/')
        ? ref
        : posix.join(posix.dirname(path), ref);
      if (/[*{]/.test(target)) continue; // glob — not a single file claim
      if (!has(target)) {
        warn(4, 'no-orphan-references',
          `${path} points at ${target}, which does not exist`);
      }
    }
  }
}

// ── Step 5 — frontmatter conforms to the closed-key schema ──────────────────

function stepFrontmatterSchema() {
  for (const path of [...walk('docs'), ...walk('.claude')]) {
    const fm = frontmatter(read(path));
    if (!fm) continue;
    for (const key of Object.keys(fm)) {
      if (!FRONTMATTER_KEYS.has(key)) {
        error(5, 'frontmatter-keys-closed',
          `${path} declares unknown frontmatter key "${key}"`);
      }
    }
    if (fm.type && !TYPE_ENUM.has(fm.type)) {
      error(5, 'frontmatter-type-enum', `${path} declares type: ${fm.type}`);
    }
    if (fm.status && !STATUS_ENUM.has(fm.status)) {
      error(5, 'frontmatter-status-enum', `${path} declares status: ${fm.status}`);
    }
    if (fm.generative_execution && !EXECUTION_ENUM.has(fm.generative_execution)) {
      error(5, 'frontmatter-execution-enum',
        `${path} declares generative_execution: ${fm.generative_execution}`);
    }
    for (const p of fm.properties ?? []) {
      if (!PROPERTY_VOCAB.has(p)) {
        error(5, 'frontmatter-property-vocabulary',
          `${path} claims to serve unknown property "${p}"`);
      }
    }
  }
}

// ── Step 6 — the harness is wired, not merely described ─────────────────────

function stepHarnessWired() {
  if (!has('.github/workflows')) {
    error(6, 'ci-workflow-exists',
      'no .github/workflows/ — a CI pipeline described in standards but absent from the repo enforces nothing');
  }
  if (!has('.githooks/pre-commit')) {
    error(6, 'hooks-installable',
      '.githooks/pre-commit is absent — hook scripts that nothing dispatches to are aspirational (Defended scores 0)');
  }
  for (const cfg of ['eslint.config.js', 'stryker.config.json']) {
    if (!has(cfg)) {
      error(6, 'quality-gate-config-exists', `${cfg} is absent but a script or standard requires it`);
    }
  }
}

// ── run ──────────────────────────────────────────────────────────────────────

stepSentinelRoot();
stepSentinelTree();
stepSpecAdr();
stepNoStubs();
stepNoOrphanReferences();
stepFrontmatterSchema();
stepHarnessWired();

const errors = findings.filter((f) => f.severity === 'error');
const warnings = findings.filter((f) => f.severity === 'warning');

if (JSON_OUT) {
  console.log(JSON.stringify({
    ran_at: new Date().toISOString(),
    errors: errors.length,
    warnings: warnings.length,
    findings,
  }, null, 2));
} else {
  const label = { error: 'ERROR  ', warning: 'warning' };
  for (const f of [...errors, ...warnings]) {
    console.log(`${label[f.severity]} [step ${f.step}] ${f.predicate}: ${f.detail}`);
  }
  console.log(`\ngs-cascade-check: ${errors.length} error(s), ${warnings.length} warning(s)`);
}

process.exit(errors.length > 0 ? 1 : 0);
