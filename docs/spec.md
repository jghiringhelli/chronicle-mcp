---
id: SPEC
type: spec-section
status: active
tier: T1
properties: [self-describing, executable, verifiable]
obligations: 14
generative_execution: unrun
depends_on: [ADR-001, ADR-010, ADR-011, ADR-012, ADR-013, ADR-014]

---

# Chronicle — Cross-Project AI Memory MCP Server

> **This is the single authoritative functional specification** (ADR-013). Where any other
> document disagrees with it, this file wins; where it disagrees with `src/`, the change is
> not done until one of the two is corrected in the same commit.
> `docs/chronicle-spec.md` is the superseded v0 design document, not current behaviour.
>
> Normative keywords are RFC 2119. **MUST** is a blocking acceptance criterion; **SHOULD** is
> defeasible and a deviation needs a recorded reason; **MAY** is permitted and ungated.
> A requirement marked *unrun* has no execution record under `docs/evidence/` and MUST NOT be
> quoted as met.

## Project metadata

| | |
|---|---|
| Name / id | Chronicle / `chronicle` |
| Created / sealed | 2026-03-03 |
| Language / runtime | TypeScript (ESM), Node `>=20 <24` |
| Build / test | tsup / vitest + Stryker |
| Storage | SQLite via `better-sqlite3`, synchronous. Keyword recall; the `embedding` column has no recall consumer (ADR-014) |
| Package manager | pnpm (pinned in `packageManager`) |
| Publish | npm, public, as `chronicle-mcp` |

## 0. Intent and scope boundary

**Intent.** Give an AI coding assistant persistent, queryable memory across every project and
session, so a new session inherits prior context instead of re-deriving it. The unit of value
is a decision or fact a future session would otherwise reconstruct from scratch.

**In scope.** Local-first storage of six memory types across three tiers; weight,
reinforcement and decay; triggers before risky actions; developer preferences; session
continuity; an optional cloud mirror; an optional team coordination layer (ADR-010); a local
read-only dashboard.

**Out of scope — explicitly.** Chronicle is NOT a code search tool (that is CodeSeeker), NOT
a spec or gate enforcer (that is ForgeCraft), NOT a task executor — `axon` records who owns
what and never runs anything — NOT a hosted service, and NOT multi-tenant. `.claude/core.md`
carries the same boundary in always-loaded form; §6 lists deferred work.

## 1. Overview

Chronicle is a standalone MCP server that gives AI coding assistants persistent, queryable memory across every project and session. It solves the cold-start problem: every AI session begins with zero context about the developer's preferences, past decisions, and hard-won solutions.

Chronicle models developer knowledge using six cognitive memory types — **Episodic**, **Semantic**, **Procedural**, **Architectural**, **Insight** and **Coordination** — giving AI assistants the full spectrum of context needed to operate as a knowledgeable long-term collaborator. The set is closed and declared once, in `src/domain/types.ts`; ADR-012 records why `Session` was removed.

Chronicle is **AI-agnostic** — works with Claude, GitHub Copilot, Cursor, Gemini, and any assistant that supports MCP. It is **local-first** — all data lives in `~/.chronicle/` on the developer's machine. It is **intelligent** — raw memories are continuously distilled into actionable profile artifacts that fit within token budgets.

## 2. Six Memory Types

Chronicle organises developer knowledge into six first-class memory types grounded in cognitive science (Tulving, 1972, 1985; Squire, 1987). Each type has distinct decay characteristics, tool surface, and retrieval semantics.

`MemoryType` is a **closed union** declared in `src/domain/types.ts`, and that declaration is
the single source for the set. Prose MUST enumerate the six names rather than assert a count.
Adding or removing a member MUST have an ADR superseding ADR-012 and MUST ship a migration for
rows holding the old value — these are persisted strings.

### Episodic — What happened

Autobiographical records of specific events: bugs encountered, solutions tried, outages caused, decisions made under pressure. Decays quickly — temporary by nature. Useful for reconstructing recent history and avoiding repeated mistakes in the short term.

- **Decay rate**: 0.10 (half-life ~7 days)
- **Example**: *"Deployed to Railway at 3pm and the Redis eviction policy reset. Took 2h to debug."*
- **Primary surface**: `chronicle(action: 'remember' | 'recall')`, `session(action: 'start' | 'end')`

### Semantic — What is true

Factual domain knowledge: API behaviours, library quirks, project conventions, team standards. Decays slowly; remains accurate for weeks or months. The knowledge a senior engineer accumulates about their stack.

- **Decay rate**: 0.02 (half-life ~35 days)
- **Example**: *"Railway does not persist `/tmp` across deploys. Use object storage for ephemeral file writes."*
- **Primary surface**: `chronicle(action: 'remember' | 'recall')`. *(`teach` and `get_lessons` are [SPECIFIED], §F8.)*

### Procedural — How to do it

Step-by-step solutions, scripts, gotchas, and recipes. Never decays. Promoted to Core tier immediately on save. The cross-project solution library.

- **Decay rate**: 0.00 (permanent)
- **Example**: *"Fix Railway env variable not loading: echo the env in build command to confirm injection timing before assuming the variable is missing."*
- **Primary surface**: `chronicle(action: 'remember', memory_type: 'procedural')`, then an unfiltered `recall` for cross-project reach. *(The dedicated solution library is [SPECIFIED], §F4.)*

### Insight — A pattern that was synthesised

A cross-session pattern about the developer or the team, produced by the distillation pass or
recorded explicitly once a pattern becomes clear. Never decays: a distilled insight is the
*output* of the intelligence layer, and decaying it means re-deriving it forever.

- **Decay rate**: 0.00 (permanent, Core tier on creation)
- **Example**: *"You consistently forget to run migrations before deploying."*
- **Primary surface**: `chronicle(action: 'remember', memory_type: 'insight')`, `chronicle(action: 'recall')`

### Coordination — Who owns what, right now

Live team coordination state: work-package ownership, assignment, dependency-graph snapshots,
merge gating. Decays slowly — team state ages out as work completes rather than staying true
forever. Inert unless a team is configured (ADR-010).

- **Decay rate**: 0.01 (half-life ~70 days, Working tier on creation)
- **Example**: *"Alice owns the auth service in sprint 3; merge-gate blocked until Chronicle v0.2 ships."*
- **Primary surface**: the `axon` tool (ADR-010, ADR-011)

### Architectural — Why it is built this way

Design decisions, trade-off rationale, constraints, and ADR-level records of alternatives considered and rejected. Never decays. The memory type most absent from competing tools.

Architectural memory closes the **drift surface**: future AI sessions inherit the *reasoning* behind choices, not just the choices themselves. Without it, an AI will silently "improve" intentional trade-offs because it cannot distinguish them from technical debt. An `architectural` memory is the `CLAUDE.md` equivalent for running sessions — a durable record that a choice was made deliberately, with the context that made it correct.

- **Decay rate**: 0.00 (permanent)
- **Example**: *"Chose better-sqlite3 over Prisma for Chronicle: synchronous API avoids async complexity in the MCP handler stack. Rejected Prisma: adds 4MB to bundle and requires migration runner."*
- **Primary surface**: `chronicle(action: 'remember', memory_type: 'architectural', confirmed: true)`, `chronicle(action: 'recall', memory_types: ['architectural'])`. *(The dedicated decision-retrieval surface is [PARTIAL], §F6.)*

> **On `Session` as a type.** The original model named a fifth type, `Session`, whose defining
> property was a 7-day TTL — exactly what the `buffer` **tier** already expresses. Keeping it
> as a *type* meant one fact had two valid encodings with contradicting decay profiles.
> Ephemeral working state is now `episodic` in the `buffer` tier; session *continuity* remains a
> first-class feature (F7), implemented over sessions rather than over a memory type.
> Full reasoning: ADR-012.

> **Competitive note.** GitHub Copilot's cross-session memory (2026) captures Episodic and limited Semantic context only. Procedural, Architectural and Insight types — the three that prevent drift and enable recovery from cold starts in architectural work — are absent. Chronicle's full six-type coverage and trigger system (F2) are its primary differentiators at the memory layer.

---

## 3. Architecture

### 3.1 Storage Tiers (Implementation Layer)

The six memory types are persisted in three implementation tiers by access frequency and permanence. Tier is seeded from the type at creation (`DEFAULT_TIERS`) and changed afterwards only by an explicit promotion — never as a side effect of reinforcement (EDR-001):

- **Buffer** — Short-term. 7-day TTL if never accessed. Holds new Episodic memories.
- **Working** — Persists across sessions, decays slowly. Holds Semantic and Coordination memories, and Episodic memories promoted by access.
- **Core** — Permanent, decay rate 0. Holds all Procedural, Architectural and Insight memories, every memory created with `confirmed: true`, and high-weight Semantic memories.

Promotion is evaluated at session end against access count: **Buffer → Working at ≥3 accesses,
Working → Core at ≥10** (`MemoryService.evaluateTierPromotions`). An earlier version of this
section said "2+ times", which the code never did.

Memories in Core MUST NOT be pruned by any consolidation pass, including the janitor (F10).

### 3.2 Memory Weight System

Every memory carries a `weight` (0.0–1.0) updated by two forces:

**Reinforcement** — each access increases weight: `weight += boost × (1 - weight)`
- Trigger check surfaced it: +0.20 boost
- Explicit recall hit: +0.15 boost
- Distill cycle selected it: +0.10 boost
- Context injection (passive): +0.05 boost
- Manual confirmed remember: +0.25 boost

**Decay** — daily background job: `weight *= e^(-decayRate × daysSinceLastAccess)`

The rates below are the authored values in `DECAY_RATES`; the half-lives are **derived**
(`ln 2 / decayRate`) and MUST NOT be edited independently of their rate.

| Memory Type | Decay Rate | Half-life | Default Tier |
|---|---|---|---|
| Episodic | 0.10 | ~6.9 days | Buffer (→ Working on access) |
| Semantic | 0.02 | ~34.7 days | Working (→ Core when confirmed) |
| Coordination | 0.01 | ~69.3 days | Working |
| Procedural | 0.00 | Never | Core (immediate) |
| Architectural | 0.00 | Never | Core (immediate) |
| Insight | 0.00 | Never | Core (immediate) |

Reinforcement MUST be asymptotic, not additive: each hit closes a fixed fraction of the
remaining distance to 1.0, so weight approaches 1.0 and never reaches it. Weight MUST stay
within `[0, 1]` for every sequence of boosts and decays. `decayRate === 0` MUST mean a decay
pass returns the memory unchanged. Derivation and the traps: EDR-001.

*("Preference" appeared in an earlier version of this table. Preferences are a separate record
type with their own table — they are not a memory type.)*

### 3.3 Intelligence Layer

Raw memories are distilled into three YAML artifacts (updated every 12h):
- `~/.chronicle/profile.yaml` — Developer identity, architecture patterns, coding style
- `~/.chronicle/lessons.yaml` — Aggregated lessons with evidence counts
- `~/.chronicle/playbook.yaml` — Condensed rules/preferences for AI system prompt injection (~500 tokens)

### 3.4 Storage

- `~/.chronicle/chronicle.db` — SQLite (`better-sqlite3`, synchronous). Each memory row carries `weight`, `access_count`, `last_accessed_at`, `decay_rate`, `tier`, `memory_type` and an `embedding` BLOB.
  **Recall is keyword matching (`LIKE`) ranked by `weight`** — not FTS5, and not vector
  similarity. The `embedding` column is written but has no recall consumer; semantic similarity
  is used only for de-duplication at promote time, and only when the optional embedding gateway
  is installed. FTS5 is the planned replacement. Reasoning and the consequence for the
  recall-latency NFR: ADR-014, EDR-002.
- `~/.chronicle/projects/<name>/` — Per-project namespaces
- YAML files for intelligence layer artifacts

## 4. Features

### The real MCP surface — read this before any F-section

The feature sections below were authored against a flat surface of ~25 separately registered
MCP tools. **That is not what ships.** ADR-011 consolidated the surface into **four** tools
that dispatch on an `action` argument, because every registered tool carries its name,
description and full JSON schema into the host agent's context on every turn:

| Tool | Actions | Covers |
|---|---|---|
| `chronicle` | `remember` `recall` `forget` `trigger` `check` `pref` `prefs` `stats` `decay` | F1, F2, F3 |
| `session` | `start` `end` `recover` | F7 |
| `axon` | `contributor_add` `spec_sync` `milestone_add` `decompose` `assign` `complete` `request_merge` `resolve_merge` `merges` `status` `queue` | team coordination (ADR-010) |
| `team` | `join` `share` `promote` `recall` `log` `insights` `stats` `sync` `members` `assign_role` `curate_insight` `mint_token` | shared team knowledge — **licence-gated**, inert without `teamToken` + `teamId` (ADR-002) |

So `remember(...)` below is `chronicle(action: 'remember', ...)`. A function name in an
F-section names a *capability*, never a registered tool. The action names are a public surface
(`.claude/standards/api.md`): renaming one is a breaking change.

**Status markers.** Each feature is marked with what is actually built, so a stateless reader
can tell specification from description:

- **[SHIPPED]** — implemented and reachable through the surface above.
- **[PARTIAL]** — some of it is reachable; the gap is named in the section.
- **[SPECIFIED]** — designed, not built. Prescriptive for future work; MUST NOT be described
  as available in a README, a release note, or a tool description.

### F1 — Core Memory Tools (MCP) — [SHIPPED]
- `remember(content, memory_type, category, tags, project?, source, confirmed?)` — Store knowledge. `memory_type`: one of `episodic | semantic | procedural | architectural | insight | coordination`; defaults to `episodic`. `confirmed: true` applies 0.25 reinforcement on creation, sets decay to 0 and places the memory in Core. `procedural`, `architectural` and `insight` start in Core regardless.
- `recall(query, project?, category?, memory_types?, tiers?, limit)` — Keyword search ranked by `weight` alone (ADR-014: not `weight × similarity`, and not FTS5). Returns weight, tier, accessCount. Word matching is OR, so relevance does not rise with the number of matched words — see EDR-002 for what that means in practice.
- `forget(id, reason)` — Remove outdated or incorrect memories.

### F2 — Trigger System — [SHIPPED]
- `set_trigger(memory_id, trigger, severity)` — Attach action triggers: deploy, publish, refactor, delete, migrate, or custom.
- `check_triggers(action, project)` — Called before risky actions; returns critical/warning/info memories. Applies +0.20 reinforcement boost on each match.

### F3 — Developer Preferences — [SHIPPED]
- `set_preference(key, value, context, strength, project?)` — Record a preference with optional project scope.
- `get_preferences(context, project?)` — Get preferences merged global + project for current context.

### F4 — Solution Library — [SPECIFIED]
- `save_solution(problem, solution, language, tags, source_project?, source_file?)` — Index a reusable solution cross-project.
- `find_solution(problem, language)` — Semantic search across all projects' solutions.

### F5 — AI Bias Tracker — [SPECIFIED]
- `report_bias(pattern, frequency, mitigation, examples)` — Document a recurring AI behaviour pattern.
- `get_biases(context)` — Retrieve known biases with mitigations for injection into AI system prompts.

### F6 — Cross-Project Context & Architectural Memory — [PARTIAL]

> **Gap.** Architectural memory itself is shipped — `memory_type: 'architectural'`, zero decay,
> Core tier. The dedicated retrieval capabilities below (`get_decisions`, `get_rationale`,
> `project_context`, `cross_pollinate`) are not built: a caller reaches the same rows through
> `chronicle(action: 'recall', memory_types: ['architectural'])`, without the cross-project
> ranking these describe.
- `remember_decision(decision, context, alternatives_considered, consequences, project?)` — Record an architectural decision with full ADR-level detail. Memory type: `architectural`. Never decays. Stored in Core tier immediately.
- `get_decisions(project?, query?, since?)` — Retrieve architectural decisions. Supports semantic search by topic or component name.
- `get_rationale(topic, project?)` — Return accumulated reasoning behind a design choice, component, or constraint — including alternatives that were rejected.
- `project_context(project, query)` — Key decisions, architectural rationale, and patterns from another project. Includes Architectural memory type.
- `cross_pollinate(current_project, task)` — Find applicable patterns, solutions, and architectural precedents from other projects.

### F7 — Session Continuity — [SHIPPED]
- `session_start(project, device?)` — Returns last session state, pending decisions, active tasks. Triggers distillation if >24h since last run.
- `session_end(project, summary?)` — Captures session state; auto-generates summary.
- `session_recover(project, token_budget, depth)` — Token-aware context recovery from crashed/interrupted session. Progressive compression: drops file contents first, then summarises decision chains, then reduces to key bullets.

### F8 — Intelligence Layer Tools — [PARTIAL]

> **Gap.** Distillation exists as a service (`src/services/distill.ts`) and runs at session
> boundaries, but none of the capabilities below is reachable through the MCP surface, and the
> three YAML artifacts in §3.3 are specified rather than emitted. Treat §3.3 as [SPECIFIED].
- `get_profile(section?)` — Developer profile, token-optimised by section.
- `get_playbook(project?, context?)` — Condensed rules for current context, ~500 tokens. Designed for AI system prompt injection.
- `get_lessons(topic?, project?, severity?)` — Aggregated lessons filtered by topic/severity.
- `distill(scope?)` — Manually trigger intelligence layer re-aggregation from raw memories.
- `teach(type, content, reason)` — Directly inject a rule/lesson/preference, bypassing accumulation.

### F9 — Insights Engine — [SPECIFIED]
- `extract_insights(scope, since?)` — Surface recurring problems, effective patterns, and improvement areas across all sessions and projects.

### F10 — JanitorService (Memory Consolidation) — [SPECIFIED]

Background process that consolidates and sanitises Chronicle's memory store using LLM-based semantic judgment — the same mechanism as Claude Code's "Auto Dream" feature, generalised to work independently of any specific AI client.

**Problem it solves:** The Ebbinghaus decay system (§3.2) handles *temporal* staleness mathematically. But it cannot detect *semantic* contradictions ("always use tabs" stored alongside "switched to spaces in session 42"), near-duplicate memories that differ only in wording, or memories that are factually stale but still frequently accessed (high weight despite being wrong).

**Design:**

```
Chronicle MCP (fast path)           JanitorService (slow path)
   remember() / recall()      ←──→  export() → LLM consolidation → import()
   Ebbinghaus weight decay           semantic dedup + contradiction detection
   synchronous, per-call             async, background, post-session
```

**Trigger conditions** (must satisfy ALL):
- ≥24h since last consolidation run
- ≥5 sessions completed since last run
- No active session lock (janitor never runs mid-session)

**What the janitor does per run:**
1. Exports all `Buffer` and `Working` tier memories as structured JSON
2. Groups by `memoryType` and `project`
3. LLM pass: detect contradictions, near-duplicates, stale facts
4. For each conflict: keep highest-weight memory; tombstone losers with reason
5. For near-duplicates: merge into single memory, sum access counts, take max weight
6. Re-import consolidated set; update weights and tombstones atomically
7. Write `~/.chronicle/janitor-log.json` (last run, memories pruned, contradictions resolved)

**Invariants:**
- `architectural` and `procedural` memories (Core tier, decay = 0.00) are **never pruned** — exempt from janitor
- Janitor uses a lockfile (`~/.chronicle/.janitor.lock`) to prevent concurrent runs
- All tombstoned memories are soft-deleted (queryable for 30 days before hard delete)
- LLM call is optional — janitor degrades gracefully to weight-only pruning if no LLM is configured

**Auto Dream integration (optional):**
When running inside a Claude Code session, Chronicle can delegate the LLM consolidation pass to Auto Dream rather than making its own API call. Chronicle detects Auto Dream availability via the presence of Claude Code's session context. If available, Chronicle exports its memory snapshot to a temp file, signals Auto Dream via the lock protocol, and re-imports the result. If unavailable, Chronicle runs its own consolidation using the configured `ANTHROPIC_API_KEY`.

**New MCP tools:**
- `janitor_status()` — Last run timestamp, memories pruned, next scheduled run
- `janitor_run(scope?)` — Manually trigger a consolidation run (scope: `all` | `project:<name>` | `type:<memoryType>`)
- `janitor_log(limit?)` — Retrieve recent consolidation decisions with reasons

**Port interface:** `JanitorService` in `src/ports/gateways/janitor-service.ts`
- `run(scope: JanitorScope): Promise<JanitorReport>`
- `getStatus(): JanitorStatus`
- `getLock(): boolean`

**Implementations:**
- `LLMJanitorService` — Full consolidation using LLM API (primary)
- `WeightOnlyJanitorService` — Prunes by weight threshold only, no LLM (fallback / offline mode)
- `AutoDreamJanitorService` — Delegates to Claude Code's Auto Dream when available (optional, detected at runtime)

### F11 — Ecosystem Registry — [SPECIFIED]

Explicit structural registry of related projects and their relationships within a developer's workspace or organisation. Where F6 tools are *query-driven* (ask Chronicle about another project), the Ecosystem Registry is *topology-driven* — Chronicle knows the shape of the project graph and can proactively surface relevant context when starting any session within the ecosystem.

**Problem it solves:** Cross-pollination and decision inheritance depend on Chronicle knowing which projects are related and how. Without explicit topology, `cross_pollinate()` can only do broad semantic search across all projects. With it, Chronicle can scope results to the actual dependency graph, propagate relevant architectural decisions along relationship edges, and warn when a decision in one project conflicts with the conventions of its dependents.

**MCP tools:**
- `register_project(name, description, type, tags, related_projects[], ecosystem?)` — Declare a project and its relationships. `type`: `library | api | cli | service | tool | experiment`. `related_projects`: array of `{ name, relationship }` where `relationship` is `depends_on | integrates_with | spawned_from | shares_conventions_with | experiment_of`. `ecosystem`: optional group label (e.g. `"pragmaworks"`).
- `get_ecosystem(root_project?, ecosystem?)` — Return the full project graph as a structured list with relationships and per-project memory counts. Optionally filter by ecosystem label.
- `ecosystem_decisions(project, scope?)` — Retrieve architectural decisions that affect related projects. `scope`: `upstream | downstream | all`. Surfaces decisions from dependencies that the current project should inherit or be aware of.
- `propagate_decision(decision_id, affects_projects[])` — Flag an architectural decision as relevant to specific related projects. On next `session_start()` in an affected project, Chronicle surfaces the decision as a priority context item.
- `ecosystem_diff(project_a, project_b)` — Compare architectural decisions, preferences, and patterns between two related projects. Highlights intentional divergences vs potential drift.

**Storage:**
- `~/.chronicle/ecosystem.json` — Project registry with relationship graph. Human-readable, editable.
- Per-project namespace entries in `memory.db` already exist (§3.4); the registry adds the relationship metadata layer on top.

**Proactive surfacing:**
When `session_start(project)` is called, Chronicle checks the ecosystem registry for the project's relationships and prepends relevant upstream decisions and shared-convention memories to the context payload — without the developer needing to query for them.

**PragmaWorks example:**
```json
{
  "ecosystem": "pragmaworks",
  "projects": [
    { "name": "forgecraft-mcp", "type": "tool", "related": [
        { "name": "chronicle-mcp", "relationship": "integrates_with" },
        { "name": "loom", "relationship": "integrates_with" },
        { "name": "storycraft", "relationship": "shares_conventions_with" }
    ]},
    { "name": "chronicle-mcp", "type": "service", "related": [
        { "name": "forgecraft-mcp", "relationship": "integrates_with" },
        { "name": "loom", "relationship": "integrates_with" }
    ]},
    { "name": "loom", "type": "tool", "related": [
        { "name": "forgecraft-mcp", "relationship": "spawned_from" }
    ]}
  ]
}
```

**Out of scope for F11 v1:** automatic relationship inference from import graphs or git history (v2), shared team ecosystems (v2).

## 5. Non-Functional Requirements

Each row is an acceptance criterion. **Verified** means an execution record exists under
`docs/evidence/`; **unrun** means no such record exists and the number MUST NOT be quoted as
met — in a README, a release note, or a pitch.

| ID | Requirement | Status |
|---|---|---|
| NFR-01 | The server MUST speak MCP over stdio and MUST be runnable as `npx -y chronicle-mcp` with no prior install. | unrun — needs a clean machine (RM-302) |
| NFR-02 | Cold start MUST complete in <300ms. | **verified 251ms** · 2026-09-12 · win32-x64, 20 cpus, node 24.18. Revised from 200ms in ADR-021: ~165ms of any measurement is Node plus the MCP SDK, leaving ~35ms for the whole application inside the old budget. Dependency-dominated, and imperceptible for a process spawned once per session. |
| NFR-03 | `recall` MUST return in <50ms with up to 10,000 memories stored. | **verified p95 13ms** at 10k (24ms at 50k) · 2026-09-12. Predicted at risk and is not: the leading-wildcard scan is real but not dominant at this scale, so FTS5 is **not** urgent — ADR-014 §3 corrected. |
| NFR-04 | The decay and promotion pass MUST complete in <500ms with up to 50,000 memories. | **verified 363ms** at 50k · 2026-09-12. Was **10,386ms** when first measured — a real defect: the pass looped one autocommitting `update` per row. Now set-based in SQL (ADR-021). |
| NFR-05 | Every local operation MUST succeed with no network available, and the server MUST NOT emit telemetry. | unrun (no offline test) |
| NFR-06 | The server MUST work on Claude Code CLI, the VS Code MCP extension, and Cursor. | unrun |
| NFR-07 | Released as `chronicle-mcp` on npm. | verified — published, v0.3.2 |
| NFR-08 | Published to the MCP Registry via `server.json` at the repo root. | **not met** — no `server.json` exists |
| NFR-09 | Absence of cloud configuration MUST leave every local operation unchanged and MUST NOT raise (ADR-010 §3). | unrun (no test) |
| NFR-10 | A memory in the Core tier MUST NOT be removed by any decay or consolidation pass. | verified by unit test (`decayRate === 0` early return, EDR-001) |

**The latency rows are measured.** `scripts/bench-nfr.mjs --full` produces
`docs/evidence/nfr-bench.json`, carrying the machine, CPU model, Node version, fixed seed and store
sizes — a number without its conditions is an anecdote. Re-run it before changing anything on the
recall or session-end path.

What remains *unrun* is the environmental set: NFR-01, 05, 06 and 09 need a clean machine and an
offline run, not a benchmark. And every measured number here comes from **one** host; a CI matrix is
what would say whether NFR-02's 300ms holds on a modest runner.

Two of the three measurements contradicted expectation — NFR-03 was predicted to miss and meets
comfortably, NFR-04 met nothing and was out by 20×. That is the argument for measuring instead of
reasoning, and it is why an unverified NFR quoted as met is how a specification stops being one.

## 6. Deferred work

> **Correction of record.** This section previously listed cloud sync, team/shared memory and
> the web dashboard as out of scope for v1 — while all three were implemented and shipping.
> A scope boundary that contradicts the code is worse than none: the next session reads it and
> "removes the unspecified feature". The permanent boundary is now stated in §0; this section
> lists only what is genuinely not built.

**Shipped since this section was written** (no longer deferred):

- Cloud sync / multi-device — optional Postgres mirror, `src/services/sync.ts` (ADR-010, EDR-003)
- Team / shared memory — the `axon` tool and the `coordination` memory type (ADR-010, EDR-004)
- Local dashboard — `src/dashboard/server.ts`, read-only, localhost only

**Genuinely deferred:**

- The F4, F5, F9, F10 and F11 surfaces (see the status markers in §4)
- The three intelligence-layer YAML artifacts in §3.3
- FTS5 recall, and any vector-similarity recall path (ADR-014 §3)
- Automatic memory extraction from git history
- A migration for rows written by pre-v0.2 builds carrying `memory_type = 'session'` (ADR-012 §2)
- Voice / AR interface

**Permanently out of scope** — these are not deferred, they are boundaries: code search,
spec/gate enforcement, task execution, hosting, multi-tenancy (§0).
