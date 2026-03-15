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

Chronicle models developer knowledge using five cognitive memory types — **Episodic**, **Semantic**, **Procedural**, **Session**, and **Architectural** — giving AI assistants the full spectrum of context needed to operate as a knowledgeable long-term collaborator.

Chronicle is **AI-agnostic** — works with Claude, GitHub Copilot, Cursor, Gemini, and any assistant that supports MCP. It is **local-first** — all data lives in `~/.chronicle/` on the developer's machine. It is **intelligent** — raw memories are continuously distilled into actionable profile artifacts that fit within token budgets.

## 2. Five Memory Types

Chronicle organises developer knowledge into five first-class memory types grounded in cognitive science (Tulving, 1972, 1985; Squire, 1987). Each type has distinct decay characteristics, tool surface, and retrieval semantics.

### Episodic — What happened

Autobiographical records of specific events: bugs encountered, solutions tried, outages caused, decisions made under pressure. Decays quickly — temporary by nature. Useful for reconstructing recent history and avoiding repeated mistakes in the short term.

- **Decay rate**: 0.10 (half-life ~7 days)
- **Example**: *"Deployed to Railway at 3pm and the Redis eviction policy reset. Took 2h to debug."*
- **Primary tools**: `remember()`, `recall()`, `session_start()`, `session_end()`

### Semantic — What is true

Factual domain knowledge: API behaviours, library quirks, project conventions, team standards. Decays slowly; remains accurate for weeks or months. The knowledge a senior engineer accumulates about their stack.

- **Decay rate**: 0.02 (half-life ~35 days)
- **Example**: *"Railway does not persist `/tmp` across deploys. Use object storage for ephemeral file writes."*
- **Primary tools**: `remember()`, `recall()`, `teach()`, `get_lessons()`

### Procedural — How to do it

Step-by-step solutions, scripts, gotchas, and recipes. Never decays. Promoted to Core tier immediately on save. The cross-project solution library.

- **Decay rate**: 0.00 (permanent)
- **Example**: *"Fix Railway env variable not loading: echo the env in build command to confirm injection timing before assuming the variable is missing."*
- **Primary tools**: `save_solution()`, `find_solution()`

### Session — What is active now

The live context of the current work session: active tasks, pending decisions, open questions, files being touched. Ephemeral (7-day TTL). Exists to enable session recovery and cross-device continuity.

- **Decay rate**: ephemeral, 7-day TTL
- **Example**: *"Currently migrating auth to Lucia v3; decision pending on edge adapter vs database adapter."*
- **Primary tools**: `session_start()`, `session_end()`, `session_recover()`

### Architectural — Why it is built this way

Design decisions, trade-off rationale, constraints, and ADR-level records of alternatives considered and rejected. Never decays. The memory type most absent from competing tools.

Architectural memory closes the **drift surface**: future AI sessions inherit the *reasoning* behind choices, not just the choices themselves. Without it, an AI will silently "improve" intentional trade-offs because it cannot distinguish them from technical debt. The `remember_decision()` tool is the `CLAUDE.md` equivalent for running sessions — a durable record that a choice was made deliberately, with the context that made it correct.

- **Decay rate**: 0.00 (permanent)
- **Example**: *"Chose better-sqlite3 over Prisma for Chronicle: synchronous API avoids async complexity in the MCP handler stack. Rejected Prisma: adds 4MB to bundle and requires migration runner."*
- **Primary tools**: `remember_decision()`, `get_decisions()`, `get_rationale()`, `project_context()`

> **Competitive note.** GitHub Copilot's cross-session memory (2026) captures Episodic and limited Semantic context only. Procedural, Session, and Architectural types — the three that prevent drift and enable recovery from cold starts in architectural work — are absent. Chronicle's full five-type coverage and trigger system (F2) are its primary differentiators at the memory layer.

---

## 3. Architecture

### 3.1 Storage Tiers (Implementation Layer)

The five memory types are persisted in three implementation tiers based on access frequency and permanence:

- **Buffer** — Short-term memories. 7-day TTL if never accessed. Auto-captured. Holds Session and new Episodic memories.
- **Working** — Promoted from Buffer when accessed 2+ times. Persists across sessions, decays slowly. Holds active Episodic and Semantic memories.
- **Core** — Permanent. Never decays. Holds all Procedural and Architectural memories, plus high-weight Semantic memories. Promoted immediately on type.

### 3.2 Memory Weight System

Every memory carries a `weight` (0.0–1.0) updated by two forces:

**Reinforcement** — each access increases weight: `weight += boost × (1 - weight)`
- Trigger check surfaced it: +0.20 boost
- Explicit recall hit: +0.15 boost
- Distill cycle selected it: +0.10 boost
- Context injection (passive): +0.05 boost
- Manual confirmed remember: +0.25 boost

**Decay** — daily background job: `weight *= e^(-decayRate × daysSinceLastAccess)`

| Memory Type | Decay Rate | Half-life | Default Tier |
|---|---|---|---|
| Episodic | 0.10 | ~7 days | Buffer → Working |
| Semantic | 0.02 | ~35 days | Working → Core |
| Preference | 0.01 | ~70 days | Working → Core |
| Procedural | 0.00 | Never | Core (immediate) |
| Architectural | 0.00 | Never | Core (immediate) |

### 3.3 Intelligence Layer

Raw memories are distilled into three YAML artifacts (updated every 12h):
- `~/.chronicle/profile.yaml` — Developer identity, architecture patterns, coding style
- `~/.chronicle/lessons.yaml` — Aggregated lessons with evidence counts
- `~/.chronicle/playbook.yaml` — Condensed rules/preferences for AI system prompt injection (~500 tokens)

### 3.4 Storage

- `~/.chronicle/memory.db` — SQLite with FTS5 + vector embeddings (`weight`, `accessCount`, `lastAccessedAt`, `decayRate`, `tier`, `memoryType` columns per memory row)
- `~/.chronicle/projects/<name>/` — Per-project namespaces
- YAML files for intelligence layer artifacts

## 4. Features

### F1 — Core Memory Tools (MCP)
- `remember(content, memoryType, category, tags, project?, confidence, source, confirmed?)` — Store knowledge. `memoryType`: one of `episodic | semantic | procedural | session | architectural`; defaults to `episodic`. `confirmed: true` applies 0.25 reinforcement on creation. `procedural` and `architectural` memories skip to Core tier immediately.
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

### F6 — Cross-Project Context & Architectural Memory
- `remember_decision(decision, context, alternatives_considered, consequences, project?)` — Record an architectural decision with full ADR-level detail. Memory type: `architectural`. Never decays. Stored in Core tier immediately.
- `get_decisions(project?, query?, since?)` — Retrieve architectural decisions. Supports semantic search by topic or component name.
- `get_rationale(topic, project?)` — Return accumulated reasoning behind a design choice, component, or constraint — including alternatives that were rejected.
- `project_context(project, query)` — Key decisions, architectural rationale, and patterns from another project. Includes Architectural memory type.
- `cross_pollinate(current_project, task)` — Find applicable patterns, solutions, and architectural precedents from other projects.

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

## 5. Non-Functional Requirements

- MCP transport: stdio, usable as `npx -y chronicle-mcp`
- Cold start: <200ms
- `recall()` response: <50ms for up to 10,000 memories
- Decay/promotion background job: <500ms for up to 50,000 memories
- No cloud dependency — fully local, no telemetry
- Compatible with Claude Code CLI, VS Code MCP extension, Cursor, and any MCP-capable client
- Published to npm as `chronicle-mcp`
- Published to MCP Registry (`server.json` in repo root)

## 6. Out of Scope (v1)

- Cloud sync / multi-device (v2)
- Team/shared memory (v2)
- Web UI dashboard (v2)
- Automatic memory extraction from git history (v2)
- Voice/AR interface (v3)
