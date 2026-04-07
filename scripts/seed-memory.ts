#!/usr/bin/env tsx
/**
 * Chronicle MCP — initial memory seed for PragmaWorks ecosystem
 * Run once: npx tsx scripts/seed-memory.ts
 * Directly uses Chronicle's service layer — no MCP transport needed.
 */

import { getDatabase } from '../src/infrastructure/db/database.js';
import { SqliteMemoryRepository } from '../src/adapters/repositories/index.js';
import { MemoryService } from '../src/services/memory-service.js';
import { NodeIdGenerator } from '../src/infrastructure/gateways/node-id-generator.js';
import { NodeClock } from '../src/infrastructure/gateways/node-clock.js';
import type { MemoryType } from '../src/domain/types.js';

const db = getDatabase();
const memSvc = new MemoryService(
  new SqliteMemoryRepository(db),
  new NodeIdGenerator(),
  new NodeClock(),
);

interface MemorySeed {
  content: string;
  memoryType: MemoryType;
  project: string;
  tags: string[];
}

const memories: MemorySeed[] = [
  {
    content: "PragmaWorks ecosystem root: C:\\workspace\\PragmaWorks. Projects: soma (coordination hub), gs/generative-specification (research + white paper + essays), loom (AI-native formal language), forge/forgecraft-mcp (governance MCP), mcp/chronicle (memory MCP), mcp/CodeSeeker (code intelligence MCP), jc-dx-experiment (April 10 DX experiment), storycraft (narrative engine), ambient/lumen (ambient platform).",
    memoryType: "architectural",
    project: "pragmaworks",
    tags: ["ecosystem", "paths", "overview"],
  },
  {
    content: "Soma (C:\\workspace\\PragmaWorks\\soma) is the coordination hub. CLAUDE.md is the sentinel — full ecosystem map, paper tree, file index. Key commands: npm run score-live, npm run collect-scores, npm run measure-quality, npm run dashboard. Migrated from C:\\workspace\\argos\\argos_automation; all dead Argos GTM code removed.",
    memoryType: "architectural",
    project: "soma",
    tags: ["hub", "coordination", "scoring", "sentinel"],
  },
  {
    content: "Generative Specification (C:\\workspace\\PragmaWorks\\gs\\generative-specification). White paper v1.3 at docs/white-paper/GenerativeSpecification_WhitePaper.md. Main claim: GS is a Martin-sense paradigm — restriction (leaving nothing implicit) activates the full formal tradition. Three causes of formal tradition abandonment: annotation fatigue, single-target value economics, tooling fragmentation. AI removes all three simultaneously. Specification constrains direction, not just output.",
    memoryType: "architectural",
    project: "generative-specification",
    tags: ["white-paper", "paradigm", "formal-tradition"],
  },
  {
    content: "GS paper tree: White paper (trunk) → Onwards! at docs/essays/onwards.md (philosophy, ACM SIGPLAN Onward! 2026) + Bio Iso (formal methodology, Artificial Life, forthcoming) + Golden Century at docs/essays/new-golden-century.md (post-scarcity, Substack). Publishing: April 10 DX → April 12 arXiv → April 13 Flea Game Substack → April 14 Loom HN → April 15 Onwards! submission.",
    memoryType: "architectural",
    project: "generative-specification",
    tags: ["paper-tree", "onwards", "bio-iso", "publishing"],
  },
  {
    content: "DX experiment: April 10 2026. 14pt CI scoring. Four conditions: naive/competent/expert control + treatment (GS). Workshop repos: gs-workshop-vaquita (greenfield), gs-workshop-taskflow (brownfield). Scoring scripts in soma/scoring/. Participants in soma/data/participants.json. Playbook at jc-dx-experiment/DRY-RUN-PLAYBOOK.md.",
    memoryType: "architectural",
    project: "generative-specification",
    tags: ["dx", "experiment", "scoring", "april10"],
  },
  {
    content: "Loom (C:\\workspace\\PragmaWorks\\loom). AI-native formal language. Spec compiles to Rust, TypeScript, Python, OpenAPI, Terraform simultaneously. 9 checkers: hoare, typestate, session, effect, security, slo, deployment, units, privacy. 311 tests, 23 milestones. Every construct traces to published theorem 350 BCE-2011 (docs/lineage.md). Pre-commit hooks block direct main commits — use feature branches.",
    memoryType: "architectural",
    project: "loom",
    tags: ["language", "formal", "checkers", "emission", "lineage"],
  },
  {
    content: "Loom is the first Bio Iso entity (directed formal autopoiesis). Distributed users = neural network. GitHub issues = sensory input. Compilation pipeline = gene expression. ALX experiments = reproductive events. Type checker = immune system. Lives as long as its soma exists. bioiso.dev and bioiso.org purchased April 5 2026.",
    memoryType: "architectural",
    project: "loom",
    tags: ["bio-iso", "autopoiesis", "genesis-organism", "alx"],
  },
  {
    content: "ForgeCraft v1.4.0 (C:\\workspace\\PragmaWorks\\forge\\forgecraft-mcp). Quality contract for AI-assisted development. 116 curated instruction blocks, 24 AI-detected tags, GS 7-property score 0-14 (threshold 11/14). Commands: setup (generates CLAUDE.md, .cursor/rules/, copilot-instructions, Status.md, hooks, PRD.md, TechSpec.md, ADR-000), verify, audit_project, check_cascade (5-step readiness gate), generate_adr, generate_session_prompt, close_cycle, start_hardening. Quality gates across 5 phases: development → pre-release hardening → release candidate → deployment → post-deployment. Dev hygiene rules for VS Code extensions, Docker containers, Python venvs, disk usage. ADR auto-sequencing in MADR format. Session continuity via Status.md + forgecraft.yaml. 6 AI assistants: Claude, Cursor, Copilot, Windsurf, Cline, Aider. npm: forgecraft-mcp. Domain: forgecraft.tools. Quality gates repo: jghiringhelli/genspec-dev-quality-gates.",
    memoryType: "architectural",
    project: "forgecraft",
    tags: ["mcp", "governance", "quality-gates", "adr", "npm", "v1.4.0"],
  },
  {
    content: "Chronicle v0.1.0 (C:\\workspace\\PragmaWorks\\mcp\\chronicle). Persistent tiered AI memory MCP. Five types with decay rates: Architectural (0.0, Core), Procedural (0.0, Core), Insight (0.0, Core), Semantic (0.02, Working), Episodic (0.10, Buffer). Three tiers: Buffer → Working (3+ accesses) → Core (permanent). 39 tests passing. DB: ~/.chronicle/chronicle.db. Seed: scripts/seed-memory.ts (11 memories seeded April 7 2026). npm: chronicle-mcp. MCP config: ~/.copilot/mcp-config.json.",
    memoryType: "architectural",
    project: "chronicle",
    tags: ["mcp", "memory", "sqlite", "tiers", "decay", "npm", "v0.1.0"],
  },
  {
    content: "CodeSeeker v2.0.1 (C:\\workspace\\PragmaWorks\\mcp\\CodeSeeker). Four-layer hybrid search + knowledge graph MCP for AI coding assistants. Pipeline: BM25 (CamelCase tokenized) + Xenova 384-dim vector embeddings → Reciprocal Rank Fusion → RAPTOR directory summaries cascade → AST graph expansion (imports/calls/extends, avg 20.8 edges/node). Three tools: search (5 modes: default/graph/vector/fts + read), analyze (dependencies/standards/duplicates/dead_code), index (init/sync/exclude/status). Zero config — auto-indexes on first use. Works with Claude Code, Copilot (VS Code 1.99+), Cursor, Windsurf, Claude Desktop. Claude Code Plugin: /plugin install codeseeker@github:jghiringhelli/codeseeker#plugin. npm: codeseeker.",
    memoryType: "architectural",
    project: "codeseeker",
    tags: ["mcp", "code-intelligence", "hybrid-search", "knowledge-graph", "raptor", "npm", "v2.0.1"],
  },
  {
    content: "Active domains: forgeworkshop.dev (GS practice, live on Vercel), bioiso.dev (Bio Iso practitioner surface, purchased April 5 2026), bioiso.org (Bio Iso research, purchased April 5 2026). Zenodo DOI: 10.5281/zenodo.19073543 (account recovery pending: jcghiri vs jghiringhelli). GitHub: jghiringhelli.",
    memoryType: "architectural",
    project: "pragmaworks",
    tags: ["domains", "bioiso", "forgeworkshop", "zenodo"],
  },
];

let ok = 0, fail = 0;
for (const m of memories) {
  try {
    const mem = memSvc.remember({
      content: m.content,
      memoryType: m.memoryType,
      project: m.project,
      tags: m.tags,
    });
    console.log(`✅ [${m.project}] ${m.content.slice(0, 60)}... → ${mem.id} (${mem.tier})`);
    ok++;
  } catch (err) {
    const detail = err instanceof Error ? err.message + ' | context: ' + JSON.stringify((err as any).context) : String(err);
    console.error(`❌ [${m.project}] ${detail}`);
    fail++;
  }
}

console.log(`\nDone: ${ok} seeded, ${fail} failed`);
db.close();



