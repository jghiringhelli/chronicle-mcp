---
project:
  name: "Chronicle"
  id: "chronicle"
  created: "2026-03-03"
  sealed: "2026-03-03"

tech_stack:
  language: typescript
  runtime: "node.js >= 20"
  module_system: ESM
  build: tsup
  test: vitest
  storage: "sqlite (better-sqlite3) + vector embeddings"
  package_manager: npm
  publish: "npm (public)"

---

# Chronicle — Cross-Project AI Memory MCP Server

## 1. Overview

Chronicle is a standalone MCP server that gives AI coding assistants persistent, queryable memory across every project and session. It solves the cold-start problem: every AI session begins with zero context about the developer's preferences, past decisions, and hard-won solutions.

Chronicle is **AI-agnostic** — works with Claude, GitHub Copilot, Cursor, Gemini, and any assistant that supports MCP. It is **local-first** — all data lives in `~/.chronicle/` on the developer's machine. It is **intelligent** — raw memories are continuously distilled into actionable profile artifacts that fit within token budgets.

## 2. Architecture

### Three-Tier Memory Model

Memory is organised into three tiers based on proven value:

- **Buffer** — Short-term session memories. 7-day TTL if never accessed. Auto-captured.
- **Working** — Promoted from Buffer when accessed 2+ times. Persists across sessions, decays slowly.
- **Core** — High-confidence, frequently-accessed knowledge. Permanent. Never decays.

### Memory Weight System

Every memory carries a `weight` (0.0–1.0) updated by two forces:

**Reinforcement** — each access increases weight: `weight += boost × (1 - weight)`
- Trigger check surfaced it: +0.20 boost
- Explicit recall hit: +0.15 boost
- Distill cycle selected it: +0.10 boost
- Context injection (passive): +0.05 boost
- Manual confirmed remember: +0.25 boost

**Decay** — daily background job: `weight *= e^(-decayRate × daysSinceLastAccess)`
- Episodic (events): rate 0.10, half-life ~7 days
- Semantic (facts): rate 0.02, half-life ~35 days
- Preference (choices): rate 0.01, half-life ~70 days
- Procedural (solutions/gotchas): rate 0.00 — **never decays**, promoted to Core immediately

### Intelligence Layer

Raw memories are distilled into three YAML artifacts (updated every 12h):
- `~/.chronicle/profile.yaml` — Developer identity, architecture patterns, coding style
- `~/.chronicle/lessons.yaml` — Aggregated lessons with evidence counts
- `~/.chronicle/playbook.yaml` — Condensed rules/preferences for AI system prompt injection (~500 tokens)

### Storage

- `~/.chronicle/memory.db` — SQLite with FTS5 + vector embeddings (`weight`, `accessCount`, `lastAccessedAt`, `decayRate`, `tier` columns per memory row)
- `~/.chronicle/projects/<name>/` — Per-project namespaces
- YAML files for intelligence layer artifacts

## 3. Features

### F1 — Core Memory Tools (MCP)
- `remember(content, category, tags, project?, confidence, source, confirmed?)` — Store knowledge. `confirmed: true` applies 0.25 reinforcement on creation. Procedural memories skip to Core tier immediately.
- `recall(query, project?, category?, limit)` — Semantic + keyword search, ranked by `weight × similarity`. Returns weight, tier, accessCount.
- `forget(id, reason)` — Remove outdated or incorrect memories.

### F2 — Trigger System
- `set_trigger(memory_id, trigger, severity)` — Attach action triggers: deploy, publish, refactor, delete, migrate, or custom.
- `check_triggers(action, project)` — Called before risky actions; returns critical/warning/info memories. Applies +0.20 reinforcement boost on each match.

### F3 — Developer Preferences
- `set_preference(key, value, context, strength, project?)` — Record a preference with optional project scope.
- `get_preferences(context, project?)` — Get preferences merged global + project for current context.

### F4 — Solution Library
- `save_solution(problem, solution, language, tags, source_project?, source_file?)` — Index a reusable solution cross-project.
- `find_solution(problem, language)` — Semantic search across all projects' solutions.

### F5 — AI Bias Tracker
- `report_bias(pattern, frequency, mitigation, examples)` — Document a recurring AI behaviour pattern.
- `get_biases(context)` — Retrieve known biases with mitigations for injection into AI system prompts.

### F6 — Cross-Project Context
- `project_context(project, query)` — Key decisions and architecture notes from another project.
- `cross_pollinate(current_project, task)` — Find applicable patterns/solutions from other projects.

### F7 — Session Continuity
- `session_start(project, device?)` — Returns last session state, pending decisions, active tasks. Triggers distillation if >24h since last run.
- `session_end(project, summary?)` — Captures session state; auto-generates summary.
- `session_recover(project, token_budget, depth)` — Token-aware context recovery from crashed/interrupted session. Progressive compression: drops file contents first, then summarises decision chains, then reduces to key bullets.

### F8 — Intelligence Layer Tools
- `get_profile(section?)` — Developer profile, token-optimised by section.
- `get_playbook(project?, context?)` — Condensed rules for current context, ~500 tokens. Designed for AI system prompt injection.
- `get_lessons(topic?, project?, severity?)` — Aggregated lessons filtered by topic/severity.
- `distill(scope?)` — Manually trigger intelligence layer re-aggregation from raw memories.
- `teach(type, content, reason)` — Directly inject a rule/lesson/preference, bypassing accumulation.

### F9 — Insights Engine
- `extract_insights(scope, since?)` — Surface recurring problems, effective patterns, and improvement areas across all sessions and projects.

## 4. Non-Functional Requirements

- MCP transport: stdio, usable as `npx -y chronicle-mcp`
- Cold start: <200ms
- `recall()` response: <50ms for up to 10,000 memories
- Decay/promotion background job: <500ms for up to 50,000 memories
- No cloud dependency — fully local, no telemetry
- Compatible with Claude Code CLI, VS Code MCP extension, Cursor, and any MCP-capable client
- Published to npm as `chronicle-mcp`
- Published to MCP Registry (`server.json` in repo root)

## 5. Out of Scope (v1)

- Cloud sync / multi-device (v2)
- Team/shared memory (v2)
- Web UI dashboard (v2)
- Automatic memory extraction from git history (v2)
- Voice/AR interface (v3)
