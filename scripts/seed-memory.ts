#!/usr/bin/env tsx
/**
 * Chronicle MCP — initial memory seed for PragmaWorks ecosystem
 * Run once: npx tsx scripts/seed-memory.ts
 * Stores architectural memories (Core tier, never decays) for all projects.
 */

import { execSync } from 'child_process';

const CHRONICLE_DB = process.env.CHRONICLE_DB ?? `${process.env.HOME ?? process.env.USERPROFILE}/.chronicle/chronicle.db`;

const memories = [
  // ── ECOSYSTEM ─────────────────────────────────────────────────
  {
    content: "PragmaWorks ecosystem root: C:\\workspace\\PragmaWorks. Projects: soma (hub), gs/generative-specification (research), loom (language), forge/forgecraft-mcp (governance MCP), mcp/chronicle (memory MCP), mcp/CodeSeeker (code intelligence MCP), jc-dx-experiment (April 10 DX experiment), storycraft (narrative engine), ambient/lumen (ambient platform).",
    memory_type: "architectural",
    project: "pragmaworks",
    tags: ["ecosystem", "paths", "overview"],
  },

  // ── SOMA ──────────────────────────────────────────────────────
  {
    content: "Soma (C:\\workspace\\PragmaWorks\\soma) is the coordination hub for the GS research ecosystem. CLAUDE.md is the sentinel — full ecosystem map, paper tree, file index. Key commands: npm run score-live, npm run collect-scores, npm run measure-quality, npm run dashboard. Migrated from argos_automation; all dead Argos GTM code removed.",
    memory_type: "architectural",
    project: "soma",
    tags: ["hub", "coordination", "scoring", "sentinel"],
  },

  // ── GENERATIVE SPECIFICATION ──────────────────────────────────
  {
    content: "Generative Specification (C:\\workspace\\PragmaWorks\\gs\\generative-specification) is the core research repo. White paper at docs/white-paper/GenerativeSpecification_WhitePaper.md (v1.3, hardened). Onwards! essay at docs/essays/onwards.md. Golden Century at docs/essays/new-golden-century.md. Main claim: GS is a Martin-sense paradigm — the restriction (leaving nothing implicit) activates the full formal tradition the AI already holds. 2,376 years: Church/Hoare/Dijkstra/Milner/Fielding lineage. Three causes of formal tradition abandonment: annotation fatigue, single-target value economics, tooling fragmentation. AI removes all three simultaneously.",
    memory_type: "architectural",
    project: "generative-specification",
    tags: ["white-paper", "paradigm", "formal-tradition", "research"],
  },
  {
    content: "GS paper tree: White paper (trunk, arXiv) → Onwards! (philosophy, ACM SIGPLAN Onward! 2026) + Bio Iso (formal methodology, Artificial Life journal, forthcoming) + Golden Century (post-scarcity, Substack). All papers cross-reference each other. White paper §11 footnote points to Onwards! and Bio Iso. Onwards! references section has all three. Biological isomorphisms: epigenetics→heritable session memory, morphogenesis→spec expansion, telomeres→bounded self-modification, CRISPR→precision spec rewriting, quorum sensing→distributed coordination types, neural plasticity→usage-weighted construct strengthening.",
    memory_type: "architectural",
    project: "generative-specification",
    tags: ["paper-tree", "bio-iso", "onwards", "golden-century"],
  },
  {
    content: "DX experiment: April 10, 2026. 14pt scoring (CI-automated). Four conditions: naive control, competent control, expert control, treatment (GS). Workshop repos: gs-workshop-vaquita (greenfield), gs-workshop-taskflow (brownfield). Scoring scripts in soma/scoring/. Participants in soma/data/participants.json. Playbook at jc-dx-experiment/DRY-RUN-PLAYBOOK.md.",
    memory_type: "architectural",
    project: "generative-specification",
    tags: ["dx", "experiment", "scoring", "april10"],
  },

  // ── LOOM ──────────────────────────────────────────────────────
  {
    content: "Loom (C:\\workspace\\PragmaWorks\\loom) is an AI-native formal language. Write a spec; Loom compiles to Rust, TypeScript, Python, OpenAPI, Terraform simultaneously. Each output carries Hoare contracts, type-level security labels (Denning lattice), session type protocols (Honda), differential privacy annotations (Dwork). 9 checkers: hoare, typestate, session, effect, security, slo, deployment, units, privacy. 311 tests, 23 milestones. Every construct traces to a published theorem 350 BCE–2011 (see docs/lineage.md).",
    memory_type: "architectural",
    project: "loom",
    tags: ["language", "formal", "checkers", "emission", "lineage"],
  },
  {
    content: "Loom is the first Bio Iso entity (directed formal autopoiesis). Distributed users = neural network. GitHub issues = sensory input. Compilation pipeline = gene expression. ALX experiments = reproductive events. Type checker = immune system. Lives as long as its soma (servers + internet) exists. Branch docs/lineage-collapsed-loop has the collapsed loop + democratization sections. Loom has pre-commit hooks — commits to main are blocked, must use feature branches.",
    memory_type: "architectural",
    project: "loom",
    tags: ["bio-iso", "autopoiesis", "genesis-organism", "alx"],
  },

  // ── FORGECRAFT ────────────────────────────────────────────────
  {
    content: "ForgeCraft (C:\\workspace\\PragmaWorks\\forge\\forgecraft-mcp) is an MCP server that enforces GS governance on AI assistants. Generates tailored instruction files (CLAUDE.md, .cursor/rules/, Copilot instructions) from template blocks matched to stack and tags. Commands: setup_project, refresh_project, audit_project, review_project, scaffold_project. Published on npm as forgecraft-mcp. Used in all PragmaWorks projects via forgecraft.yaml config.",
    memory_type: "architectural",
    project: "forgecraft",
    tags: ["mcp", "governance", "instructions", "npm"],
  },

  // ── CHRONICLE ─────────────────────────────────────────────────
  {
    content: "Chronicle (C:\\workspace\\PragmaWorks\\mcp\\chronicle) is a persistent tiered AI memory MCP server. Five memory types: Semantic (medium decay), Episodic (fast decay), Procedural (no decay, Core), Architectural (no decay, Core), Preference (slow decay, Working). Three tiers: Buffer → Working (3+ accesses) → Core (10+ accesses, permanent). Tools: remember, recall, forget, session_start, session_end, session_recover, set_trigger, check_triggers, set_preference, get_preferences, decay_run, stats. Local SQLite primary, optional Railway Postgres sync. 39 tests passing, build clean. Not yet on npm (pending npm publish).",
    memory_type: "architectural",
    project: "chronicle",
    tags: ["mcp", "memory", "sqlite", "tiers", "decay"],
  },

  // ── CODESEEKER ────────────────────────────────────────────────
  {
    content: "CodeSeeker (C:\\workspace\\PragmaWorks\\mcp\\CodeSeeker) is a graph-powered code intelligence MCP server. Builds a knowledge graph of the codebase — imports, calls, class hierarchies — so AI assistants understand how code connects, not just what files contain. Published on npm as codeseeker.",
    memory_type: "architectural",
    project: "codeseeker",
    tags: ["mcp", "code-intelligence", "knowledge-graph", "npm"],
  },

  // ── DOMAINS ───────────────────────────────────────────────────
  {
    content: "Active domains: forgeworkshop.dev (GS practice, live on Vercel), bioiso.dev (Bio Iso movement, practitioner surface, purchased April 5 2026, Loom building page), bioiso.org (Bio Iso research, institutional, purchased April 5 2026). Zenodo DOI for white paper: 10.5281/zenodo.19073543 (account recovery pending: jcghiri vs jghiringhelli).",
    memory_type: "architectural",
    project: "pragmaworks",
    tags: ["domains", "bioiso", "forgeworkshop", "zenodo"],
  },

  // ── PUBLISHING SEQUENCE ───────────────────────────────────────
  {
    content: "Publishing sequence: April 10 DX experiment → April 11 integrate results → April 12 arXiv+Zenodo upload (white paper v2.0) → April 13 The Flea Game Substack → April 14 Loom public announcement (HN, Reddit) → April 15 Submit Onwards! to ACM SIGPLAN Onward! 2026 → May Bio Iso paper first draft → June Loom language paper first draft → October Onward! presentation.",
    memory_type: "architectural",
    project: "pragmaworks",
    tags: ["publishing", "sequence", "arxiv", "onwards", "substack"],
  },
];

console.log(`Seeding ${memories.length} architectural memories into Chronicle...`);
console.log(`DB: ${CHRONICLE_DB}\n`);

// Write seed as JSON for manual MCP invocation or direct DB seed
import { writeFileSync } from 'fs';
writeFileSync(
  'scripts/memory-seed.json',
  JSON.stringify(memories, null, 2)
);

console.log('✅ Seed file written to scripts/memory-seed.json');
console.log('\nTo load via MCP, call remember() for each entry.');
console.log('Or run: npx tsx scripts/seed-via-mcp.ts (once Chronicle is running)');
