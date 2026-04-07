#!/usr/bin/env tsx
/**
 * Update stale Chronicle memories for ForgeCraft and CodeSeeker.
 * Finds existing entries by project tag and replaces them.
 */

import { getDatabase } from '../src/infrastructure/db/database.js';
import { SqliteMemoryRepository } from '../src/adapters/repositories/index.js';
import { MemoryService } from '../src/services/memory-service.js';
import { NodeIdGenerator } from '../src/infrastructure/gateways/node-id-generator.js';
import { NodeClock } from '../src/infrastructure/gateways/node-clock.js';

const db = getDatabase();
const repo = new SqliteMemoryRepository(db);
const svc = new MemoryService(repo, new NodeIdGenerator(), new NodeClock());

const updates = [
  {
    project: 'forgecraft',
    content: "ForgeCraft v1.4.0 (C:\\workspace\\PragmaWorks\\forge\\forgecraft-mcp). Quality contract for AI-assisted development. 116 curated instruction blocks, 24 AI-detected tags, GS 7-property score 0-14 (threshold 11/14). Commands: setup (generates CLAUDE.md, .cursor/rules/, copilot-instructions, Status.md, hooks, PRD.md, TechSpec.md, ADR-000), verify, audit_project, check_cascade (5-step readiness gate), generate_adr, generate_session_prompt, close_cycle, start_hardening. Quality gates across 5 phases: development → pre-release hardening → release candidate → deployment → post-deployment. Dev hygiene rules for VS Code extensions, Docker containers, Python venvs, disk usage. ADR auto-sequencing in MADR format. Session continuity via Status.md + forgecraft.yaml. 6 AI assistants: Claude, Cursor, Copilot, Windsurf, Cline, Aider. npm: forgecraft-mcp. Domain: forgecraft.tools. Quality gates repo: jghiringhelli/genspec-dev-quality-gates.",
    tags: ["mcp", "governance", "quality-gates", "adr", "npm", "v1.4.0"],
  },
  {
    project: 'codeseeker',
    content: "CodeSeeker v2.0.1 (C:\\workspace\\PragmaWorks\\mcp\\CodeSeeker). Four-layer hybrid search + knowledge graph MCP for AI coding assistants. Pipeline: BM25 (CamelCase tokenized) + Xenova 384-dim vector embeddings → Reciprocal Rank Fusion → RAPTOR directory summaries cascade → AST graph expansion (imports/calls/extends, avg 20.8 edges/node). Three tools: search (5 modes: default/graph/vector/fts + read), analyze (dependencies/standards/duplicates/dead_code), index (init/sync/exclude/status). Zero config — auto-indexes on first use. Works with Claude Code, Copilot (VS Code 1.99+), Cursor, Windsurf, Claude Desktop. Claude Code Plugin: /plugin install codeseeker@github:jghiringhelli/codeseeker#plugin. npm: codeseeker.",
    tags: ["mcp", "code-intelligence", "hybrid-search", "knowledge-graph", "raptor", "npm", "v2.0.1"],
  },
];

// Find and delete existing entries by project using direct SQLite
for (const update of updates) {
  const rows = db.prepare('SELECT id FROM memories WHERE project = ?').all(update.project) as { id: string }[];
  for (const row of rows) {
    svc.forget(row.id, `replaced with updated ${update.project} memory`);
    console.log(`🗑️  Deleted stale: ${row.id} [${update.project}]`);
  }
  const mem = svc.remember({
    content: update.content,
    memoryType: 'architectural',
    project: update.project,
    tags: update.tags,
    confirmed: true,
  });
  console.log(`✅ Seeded: ${mem.id} [${update.project}] (${mem.tier})`);
}

db.close();
