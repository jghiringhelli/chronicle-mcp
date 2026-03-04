# Chronicle — Cross-Project AI Memory MCP Server

## One-Liner

Persistent, queryable memory layer that makes AI assistants remember decisions, preferences, solutions, and mistakes across every project and session.

## Problem

Every AI coding session starts cold. Claude doesn't know:
- That you prefer Tailwind over CSS modules
- That you solved this exact problem last week in another project
- That it has a tendency to over-abstract error handling
- Why you chose PostgreSQL over MongoDB three months ago
- What was discussed in the last session before you closed your laptop

This gets worse with multiple projects. Solutions discovered in CodeSeeker are invisible when working on Conclave. Preferences expressed once are forgotten. The same mistakes repeat.

For voice/phone/AR workflows, this is a blocker. You can't re-explain context every time you switch devices.

## Solution

Chronicle is a standalone MCP server that maintains a persistent, cross-project knowledge base. Every AI assistant session reads from and writes to Chronicle, building a cumulative understanding of the developer, their projects, and their engineering decisions.

## Core Concept: Intelligence, Not Storage

Chronicle is NOT a memory dump. It has three tiers and an intelligence layer:

### Three-Tier Memory Model (inspired by cognitive science)

1. **Buffer** — Short-term session memories. Fast, ephemeral. Auto-captured during a session.
2. **Working** — Promoted from buffer when accessed again or explicitly confirmed. Persists across sessions.
3. **Core** — High-confidence, frequently-accessed knowledge that has proven its value. Never decays.

Memories promote upward automatically based on access patterns, recency, and cross-project relevance. They also decay — buffer memories expire after 7 days if never accessed again. Working memories fade gradually. Core memories are permanent.

4. **Intelligence layer** — Aggregated, distilled knowledge that evolves over time (profile, lessons, playbook)

The raw layer is append-only. The intelligence layer is continuously refined. When you've made 47 individual decisions about error handling across 5 projects, Chronicle doesn't return all 47 — it returns a distilled **Developer Profile** entry:

```
Error Handling Style (confidence: high, based on 47 observations across 5 projects):
- Uses Result<T, E> types in library code, throw only at boundaries
- Prefers custom error classes extending a base error
- Always includes structured context in error logs
- Avoids try-catch for flow control
- Exception: HTTP handlers use try-catch with status code mapping
```

This is what gets injected into AI context — not raw memories, but aggregated intelligence.

## Architecture

```
┌───────────────────────────────────────────────────────────┐
│                      Chronicle MCP                         │
│                                                            │
│  ┌─────────────────────────────────────────────────────┐  │
│  │              Intelligence Layer                      │  │
│  │                                                      │  │
│  │  ┌──────────────┐  ┌───────────┐  ┌─────────────┐  │  │
│  │  │  Developer   │  │  Lessons  │  │  Coding     │  │  │
│  │  │  Profile     │  │  Learned  │  │  Playbook   │  │  │
│  │  └──────────────┘  └───────────┘  └─────────────┘  │  │
│  │                                                      │  │
│  │  Distills raw memories → aggregated knowledge        │  │
│  │  Runs periodically + on demand                       │  │
│  └──────────────────────┬──────────────────────────────┘  │
│                         │                                  │
│  ┌──────────────────────┴──────────────────────────────┐  │
│  │                Raw Layer                             │  │
│  │                                                      │  │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────────────┐  │  │
│  │  │ Memories │  │ Solutions│  │  Session Records │  │  │
│  │  │  Store   │  │  Library │  │                  │  │  │
│  │  └──────────┘  └──────────┘  └──────────────────┘  │  │
│  │                                                      │  │
│  │  ┌────────────────────────────────────────────────┐  │  │
│  │  │     Semantic Index (SQLite + embeddings + FTS) │  │  │
│  │  └────────────────────────────────────────────────┘  │  │
│  └─────────────────────────────────────────────────────┘  │
│                                                            │
│  ┌──────────┐  ┌──────────┐  ┌──────────────┐            │
│  │  Bias    │  │ Insights │  │   Session    │            │
│  │ Tracker  │  │ Extractor│  │  Continuity  │            │
│  └──────────┘  └──────────┘  └──────────────┘            │
└───────────────────────────────────────────────────────────┘
         ↑               ↑              ↑
    CodeSeeker      ForgeCraft       Conclave
    (any project)   (any project)   (any project)
```

### Memory Types with Decay Profiles

Different kinds of knowledge age differently:

| Type | Description | Decay | Example |
|------|-------------|-------|---------|
| **Semantic** | Facts, definitions, how things work | Slow (months) | "CodeSeeker uses SQLite for embedded mode" |
| **Episodic** | Events, what happened when | Medium (weeks) | "Yesterday's deploy failed due to missing env var" |
| **Procedural** | How-to knowledge, workflows | **Never decays** | "npm publish requires manual 2FA" |
| **Preference** | Developer choices and style | Slow (months) | "Prefers Tailwind over CSS modules" |

Procedural memories (hard-won solutions, gotchas, workflow knowledge) are promoted directly to Core tier and never age out — they represent lessons too expensive to relearn.

### Memory Weight System

Every memory carries a `weight` — a floating point score that determines how prominently it surfaces in context injection, recall ranking, and distillation cycles. Weight is the mechanism that makes Chronicle behave like human long-term memory: frequently-used knowledge strengthens, rarely-used knowledge fades.

#### Weight Schema

```typescript
interface MemoryWeight {
  weight: number;          // Current relevance score: 0.0 – 1.0
  accessCount: number;     // Total times this memory was returned by recall/check_triggers/injection
  lastAccessedAt: string;  // ISO timestamp of last access
  createdAt: string;
  decayRate: number;       // Daily decay coefficient (per-category default, overridable)
  tier: 'buffer' | 'working' | 'core';
}
```

#### Reinforcement — How Weight Grows

Each time a memory is accessed (recalled, injected into context, or cited in a trigger check), its weight increases:

```
weight_new = weight_old + reinforcement_boost * (1 - weight_old)
```

The `(1 - weight_old)` factor is a ceiling correction — memories already near 1.0 gain diminishing returns from each additional access (like human expert knowledge: already at the top, hard to go higher). The boost magnitude depends on access type:

| Access type | `reinforcement_boost` | Rationale |
|---|---|---|
| Explicit `recall()` query hit | `0.15` | Developer consciously retrieved it |
| Trigger check surfaced it | `0.20` | Fired at a critical moment — high value signal |
| Context injection (session start) | `0.05` | Passive inclusion — lower signal |
| `distill` cycle selected it | `0.10` | Intelligence layer found it worth aggregating |
| Manual `remember()` with `confirmed: true` | `0.25` | Developer explicitly reinforced it |

#### Decay — How Weight Fades

Every 24 hours, a background job applies exponential decay to all non-Core memories:

```
weight_new = weight_old * e^(-decayRate * daysSinceLastAccess)
```

This mirrors the Ebbinghaus forgetting curve: knowledge degrades fastest when not used, but each retrieval resets the decay clock by resetting `lastAccessedAt`.

**Per-category default decay rates:**

| Category | `decayRate` | Half-life | Rationale |
|---|---|---|---|
| Episodic (events, what happened) | `0.10` | ~7 days | Recency is the value; old events become noise |
| Semantic (facts, how things work) | `0.02` | ~35 days | Facts stay relevant longer |
| Preference (developer choices) | `0.01` | ~70 days | Preferences are stable — slow drift |
| Procedural (how-to, solutions, gotchas) | `0.00` | **Never** | Promoted to Core; exempt from decay |

#### Tier Promotion and Demotion

Tier changes are evaluated nightly:

```
Buffer   → Working  when  weight >= 0.4  AND  accessCount >= 2
Working  → Core     when  weight >= 0.8  AND  accessCount >= 5  AND  age >= 7 days
Working  → Archive  when  weight <  0.1
Buffer   → Archive  when  age > 7 days   AND  weight < 0.2  (never accessed)
```

Core memories are exempt from demotion and decay. Once a memory has proven its value across time, it is permanent.

#### Injection Prioritisation

When Chronicle builds a context window for an AI session, memories compete for the token budget. Weight determines slot allocation:

1. **Core** memories — always included (up to their category cap)
2. **Working** memories — sorted by weight descending until budget exhausted
3. **Buffer** memories — only included if directly relevant to the current query

This means a decision you've revisited 20 times appears in *every* session, while a half-baked idea from last Tuesday fades out naturally — exactly like human working memory keeping frequently-used knowledge on top of mind.

#### Example Weight Lifecycle

```
Day 0   — `remember("Use nodejs-lts for Chocolatey")` created     weight: 0.50 (initial, Procedural → Core immediately)
Day 0   — trigger check fires before first Chocolatey build        weight: 1.00 (Core, exempt from decay, ceiling hit)

Day 0   — `remember("Tried graphql for the API")` created          weight: 0.30 (initial, Episodic, buffer tier)
Day 3   — never accessed, decay applied (rate 0.10)                weight: 0.22
Day 7   — never accessed                                           weight: 0.16 → demoted to Archive
```

### Fact Triples and Contradiction Resolution

Chronicle stores factual knowledge as subject-predicate-object triples, enabling structured queries and automatic contradiction detection:

```yaml
# When you say "CodeSeeker uses PostgreSQL" but a memory says "CodeSeeker uses SQLite":
fact_conflict:
  subject: "codeseeker"
  predicate: "database"
  existing: "SQLite (embedded mode)"
  incoming: "PostgreSQL (server mode)"
  resolution: "both_valid"  # both | newer_wins | ask_user
  context: "CodeSeeker supports both — SQLite for embedded, PostgreSQL for server mode"
```

When contradictions are detected, Chronicle resolves them based on timestamps, confidence levels, and context. Ambiguous conflicts are surfaced to the user during the next `distill` cycle.

### Storage

Local-first, lives in `~/.chronicle/` (user home, not per-project):
- `memory.db` — SQLite with vector embeddings (three-tier memory). Each memory row stores `weight`, `accessCount`, `lastAccessedAt`, `decayRate`, and `tier` alongside content and embeddings.
- `profile.yaml` — Distilled developer profile (intelligence layer)
- `lessons.yaml` — Aggregated lessons learned (intelligence layer)
- `playbook.yaml` — Coding style playbook (intelligence layer)
- `biases.json` — Known AI behavior patterns
- Per-project namespaces in `~/.chronicle/projects/<name>/`

A nightly background job (`chronicle decay`) runs the weight decay pass and evaluates tier promotions/demotions. It runs at process startup if last run was >24h ago, so no daemon is required.

### Why Standalone (Not a Conclave Role)

- Persists **across** projects — Conclave is per-project
- Persists **across** tools — ForgeCraft, CodeSeeker, Conclave all read/write
- Persists **across** sessions — survives IDE restarts, device switches
- Has its own storage — not tied to any project's lifecycle

## MCP Tools

### Core Memory

#### `remember`
Store a piece of knowledge with context.

```typescript
remember({
  content: "Use nodejs-lts instead of nodejs for Chocolatey dependencies",
  category: "solution",          // solution | decision | preference | insight | bias | gotcha
  tags: ["chocolatey", "nodejs", "packaging"],
  project: "codeseeker",         // optional — omit for cross-project knowledge
  confidence: "verified",        // verified | likely | experimental
  source: "manual",              // manual | auto-extracted | observed
  confirmed: true,               // optional — signals strong intent, applies 0.25 reinforcement boost on creation
})
```

The `confirmed` flag is for knowledge you know is important right now. Unconfirmed memories start at default weight and earn their ranking through access patterns.

#### `recall`
Query memory by natural language. Returns relevant memories ranked by weight × semantic similarity.

```typescript
recall({
  query: "How do we handle Chocolatey packaging?",
  project: "codeseeker",         // optional — search all projects if omitted
  category: "solution",          // optional filter
  limit: 5
})
// Returns: memories with content, context, when learned, confidence,
//          weight (how reinforced this memory is), tier, accessCount
```

#### `forget`
Remove outdated or incorrect memories.

```typescript
forget({
  id: "mem_abc123",
  reason: "No longer relevant — we dropped Chocolatey support"
})
```

### Triggers (Pre-Action Safety)

Memories can be tagged with **triggers** — context labels that cause automatic recall before specific actions. This is a safety mechanism that surfaces relevant knowledge exactly when you need it.

#### `set_trigger`
Attach a trigger to a memory or lesson.

```typescript
set_trigger({
  memory_id: "mem_abc123",           // or create inline
  trigger: "deploy",                 // deploy | publish | refactor | delete | migrate | custom:*
  content: "Always check that STRIPE_WEBHOOK_SECRET is set in production env",
  severity: "critical"               // critical | warning | info
})
```

#### `check_triggers`
Called automatically before risky actions. Returns all triggered memories.

```typescript
check_triggers({
  action: "deploy",
  project: "conclave"
})
// Returns: [
//   { severity: "critical", content: "Check STRIPE_WEBHOOK_SECRET in prod env" },
//   { severity: "warning", content: "Last deploy needed manual DB migration — verify schema" }
// ]
```

**Built-in trigger hooks:**
- `trigger:deploy` — Before any deployment action
- `trigger:publish` — Before npm publish, GitHub release
- `trigger:refactor` — Before large refactoring operations
- `trigger:delete` — Before deleting files, branches, databases
- `trigger:migrate` — Before database migrations

### Developer Preferences

#### `set_preference`
Record a developer preference.

```typescript
set_preference({
  key: "styling",
  value: "tailwind",
  context: "Always use Tailwind CSS. Never suggest CSS modules or styled-components.",
  strength: "strong"             // strong | mild | default
})
```

#### `get_preferences`
Retrieve preferences relevant to current context.

```typescript
get_preferences({
  context: "setting up a React frontend",
  project: "conclave"            // optional — merges global + project prefs
})
// Returns: { styling: "tailwind", components: "functional", state: "zustand", ... }
```

### Solution Library

#### `save_solution`
Index a reusable solution from any project.

```typescript
save_solution({
  problem: "WebSocket reconnection with exponential backoff",
  solution: "...",               // code snippet or description
  language: "typescript",
  tags: ["websocket", "resilience", "networking"],
  source_project: "codeseeker",
  source_file: "src/ws-client.ts",
  source_lines: "45-89"
})
```

#### `find_solution`
Search for solutions to a problem across all projects.

```typescript
find_solution({
  problem: "Need to implement rate limiting for API endpoints",
  language: "typescript"
})
// Returns: matching solutions from any project, ranked by relevance
```

### AI Bias Tracker

#### `report_bias`
Document a recurring AI behavior pattern.

```typescript
report_bias({
  pattern: "Creates unnecessary wrapper functions around simple operations",
  frequency: "common",          // common | occasional | rare
  mitigation: "Explicitly ask: 'Do not create wrapper functions unless there are 3+ call sites'",
  examples: ["codeseeker#utils/helpers.ts", "conclave#packages/core/src/wrappers.ts"]
})
```

#### `get_biases`
Retrieve known biases relevant to current task.

```typescript
get_biases({
  context: "implementing a new service class"
})
// Returns: relevant biases with mitigations — can be injected into system prompts
```

### Cross-Project Context

#### `project_context`
Get a summary of another project's relevant knowledge.

```typescript
project_context({
  project: "codeseeker",
  query: "How is the MCP server structured?"
})
// Returns: key decisions, architecture notes, relevant solutions from that project
```

#### `cross_pollinate`
Find patterns/solutions from other projects applicable to current work.

```typescript
cross_pollinate({
  current_project: "conclave",
  task: "implementing a plugin system"
})
// Returns: "CodeSeeker has a plugin system in src/plugins/ using dynamic imports.
//          ForgeCraft uses template composition. Here are the relevant patterns..."
```

### Session Continuity

#### `session_start`
Called when a new session begins. Returns context from last session.

```typescript
session_start({
  project: "conclave",
  device: "phone"                // optional — helps tailor summary verbosity
})
// Returns: {
//   last_session: "2 hours ago on desktop",
//   changes_since: ["3 files modified in packages/core", "tests passing"],
//   pending_decisions: ["Choose between Redis Streams vs NATS for prod message bus"],
//   active_tasks: ["Implementing bounce protocol", "DAG cycle detection"]
// }
```

#### `session_end`
Called when session ends. Captures final state.

```typescript
session_end({
  project: "conclave",
  summary: "auto"                // auto-generates from session activity
})
```

#### `session_recover`
Recover context from a crashed or interrupted session. Uses token-aware compression to rebuild context within budget.

```typescript
session_recover({
  project: "conclave",
  token_budget: 2000,            // Max tokens for the recovery summary
  depth: "full"                  // full | brief | minimal
})
// Returns: {
//   recovered_from: "session_abc (crashed 2h ago, 45 min duration)",
//   context_summary: "Working on bounce protocol. Modified 3 files...",
//   pending_decisions: ["Redis vs NATS for message bus"],
//   uncommitted_changes: ["src/roles/architect.ts", "src/protocols/bounce.ts"],
//   suggested_next: "Continue implementing bounce timeout logic in protocols/bounce.ts:145"
// }
```

**Token-aware compression**: Chronicle tracks the approximate token count of recovery summaries. When the session history exceeds the token budget, it progressively compresses: first drops file contents, then summarizes decision chains, then reduces to key bullet points. This ensures phone/AR sessions get useful context without blowing the context window.

### Insights Engine

#### `extract_insights`
Analyze memories and solutions to surface patterns.

```typescript
extract_insights({
  scope: "all",                  // all | project:<name> | category:<cat>
  since: "30d"
})
// Returns: {
//   recurring_problems: ["ESM/CJS compatibility issues across all projects"],
//   effective_patterns: ["Guard clauses used in 90% of functions"],
//   improvement_areas: ["Test coverage for error paths is consistently low"],
//   tool_recommendations: ["Consider adding vitest for Conclave — used successfully in ForgeCraft"]
// }
```

## Intelligence Layer — The Core Differentiator

Raw memories are inputs. The intelligence layer is what makes Chronicle useful. It continuously distills hundreds of individual observations into structured, actionable knowledge.

### Three Aggregated Artifacts

#### 1. Developer Profile (`profile.yaml`)

A living document that captures who the developer is as an engineer. Updated automatically as patterns emerge from memories.

```yaml
# ~/.chronicle/profile.yaml
# Auto-generated — DO NOT edit manually. Chronicle updates this from observations.
# Last distilled: 2026-02-24T18:30:00Z (from 342 memories across 5 projects)

identity:
  name: "JC"
  active_projects: ["codeseeker", "forgecraft", "conclave"]
  primary_languages: ["typescript"]
  experience_signals: "senior"        # Inferred from decision patterns and code complexity

architecture:
  preferred_patterns:
    - pattern: "Layered architecture with strict dependency direction"
      confidence: high                # Observed in 4/5 projects
      evidence: ["codeseeker: CLI→services→shared", "conclave: packages/core→roles→actions"]
    - pattern: "SOLID principles — particularly SRP and DI"
      confidence: high
      evidence: ["forgecraft: single-purpose template classes", "codeseeker: 6 focused services from 1 god class"]
  state_management: "SQLite for dev, PostgreSQL/Redis for prod"
  api_style: "REST with typed contracts"
  monorepo_preference: "pnpm workspaces for multi-package projects"

coding_style:
  error_handling:
    approach: "Result<T, E> in library code, throw at boundaries only"
    confidence: high
    evidence_count: 47
    nuance: "HTTP handlers use try-catch with status code mapping"
  naming:
    files: "kebab-case (e.g., workflow-orchestrator.ts)"
    classes: "PascalCase"
    functions: "camelCase, verb-first (findReadyTasks, publishMessage)"
    constants: "UPPER_SNAKE_CASE"
  testing:
    framework: "vitest for new projects, jest for existing"
    approach: "Unit + integration, 80% coverage target"
    pattern: "Guard clauses over nested conditionals in test setup"
  typing:
    strictness: "strict mode always, no any — use unknown and narrow"
    preference: "interface for shapes, type for unions"
  functions:
    max_length: 30
    style: "Pure where possible, guard clauses, CQS"

tooling:
  build: "tsup or tsc depending on project"
  package_manager: "npm for published packages, pnpm for monorepos"
  linting: "ESLint + Prettier, strict rules"
  ci: "GitHub Actions"

interests:
  current_focus: "Autonomous AI orchestration, MCP ecosystem"
  domains: ["developer tooling", "AI infrastructure", "code intelligence"]
  exploring: ["AR/voice interfaces for coding", "spec-driven development"]

communication_style:
  prefers: "Concise, direct, no fluff"
  decision_speed: "Fast — prefers action over analysis paralysis"
  feedback_style: "Pushes back on over-engineering, values simplicity"
```

#### 2. Lessons Learned (`lessons.yaml`)

Aggregated from gotchas, solutions, and repeated problems. Each lesson is distilled from multiple raw memories.

```yaml
# ~/.chronicle/lessons.yaml
# Auto-generated from raw memories. Each lesson backed by evidence.
# Last distilled: 2026-02-24T18:30:00Z

packaging:
  - lesson: "Chocolatey's nodejs package hangs — always use nodejs-lts"
    severity: critical
    projects: ["codeseeker"]
    raw_memory_count: 4
    details: |
      The nodejs Chocolatey package depends on nodejs.install which uses
      ADDLOCAL=ALL in its MSI — this triggers Visual Studio build tools
      setup that hangs in automated test environments. nodejs-lts is a
      separate package (different maintainer, jtcmedia) that uses /qn
      /norestart flags and consistently passes verification in ~1.5 min.
    also_learned:
      - "Cannot call choco commands from chocolateyinstall.ps1"
      - "npm 2FA blocks automated publishing since Dec 2025 — always manual"
      - "Set CI=true + npm_config_yes=true for non-interactive npm"

  - lesson: "npm publish requires manual 2FA — cannot automate"
    severity: important
    projects: ["codeseeker", "forgecraft"]
    details: "npm revoked all classic tokens Dec 2025. Always publish manually first, then trigger GitHub Actions for other channels."

mcp_ecosystem:
  - lesson: "MCP Registry is the canonical discovery source — VS Code @mcp reads from it"
    severity: important
    projects: ["codeseeker", "forgecraft"]
    details: "server.json in repo root + mcp-publisher CLI. The title field is what VS Code displays."

  - lesson: "awesome-mcp-servers (punkpeye) is highest leverage for aggregator discovery"
    severity: important
    details: "Glama.ai syncs from this repo. Single PR gets you on multiple directories."

  - lesson: "Smithery requires remote HTTP transport — skip for local stdio servers"
    severity: minor
    projects: ["codeseeker", "forgecraft"]

typescript:
  - lesson: "ESM/CJS compatibility requires explicit file extensions in imports"
    severity: moderate
    projects: ["codeseeker", "forgecraft", "conclave"]
    recurrence: 3

ai_behavior:
  - lesson: "Claude tends to create unnecessary wrapper functions"
    severity: moderate
    mitigation: "Explicitly state: no wrappers unless 3+ call sites"
    recurrence: 8

  - lesson: "Claude over-engineers error handling with redundant try-catch"
    severity: moderate
    mitigation: "Reference coding style: Result types in library code"
    recurrence: 5

  - lesson: "Claude adds docstrings/comments to unchanged code when editing nearby"
    severity: minor
    mitigation: "State: only modify what was asked, no drive-by improvements"
    recurrence: 12
```

#### 3. Coding Playbook (`playbook.yaml`)

The actionable subset — what gets injected into AI context at session start. This is the distilled "how to work with this developer" guide.

```yaml
# ~/.chronicle/playbook.yaml
# The condensed intelligence that gets injected into every AI session.
# Optimized for token efficiency — only the actionable parts.
# Last distilled: 2026-02-24T18:30:00Z

# RULES — hard constraints, always apply
rules:
  - "Use kebab-case filenames, PascalCase classes, camelCase functions"
  - "Strict TypeScript — no any, use unknown + narrowing"
  - "Result<T,E> in library code, throw only at HTTP/CLI boundaries"
  - "Guard clauses over nested conditionals"
  - "Max 30 lines per function"
  - "No wrapper functions unless 3+ call sites"
  - "No drive-by improvements — only change what was asked"
  - "No docstrings on unchanged code"
  - "Interface for object shapes, type for unions"
  - "Named exports only, no default exports"

# PREFERENCES — soft constraints, follow unless there's a good reason
preferences:
  - "Tailwind CSS for styling"
  - "Zustand for React state management"
  - "vitest for new projects, jest for existing"
  - "pnpm for monorepos, npm for single packages"
  - "SQLite for dev/embedded, PostgreSQL for server"

# PITFALLS — things that have gone wrong before
pitfalls:
  - "Chocolatey: use nodejs-lts, not nodejs (MSI hang)"
  - "npm publish is always manual (2FA since Dec 2025)"
  - "MCP servers: always pass project parameter to avoid wrong index"
  - "ESM imports need explicit .js extensions even for .ts files"

# ACTIVE INTERESTS — weight these topics in suggestions
interests:
  - "Autonomous AI orchestration"
  - "MCP server ecosystem"
  - "Spec-driven development"
  - "Voice/AR coding interfaces"
```

### Intelligence Layer MCP Tools

#### `get_profile`
Returns the distilled developer profile. Used by AI assistants to understand who they're working with.

```typescript
get_profile({
  section: "all"                 // all | architecture | coding_style | tooling | interests
})
// Returns: the relevant section(s) of profile.yaml
// Token-optimized — returns only what's needed for current context
```

#### `get_playbook`
Returns the coding playbook — the condensed rules for working with this developer. Designed to be injected at session start.

```typescript
get_playbook({
  project: "conclave",           // optional — merges global + project-specific rules
  context: "implementing a new service"  // optional — filters to relevant rules
})
// Returns: rules + preferences + pitfalls relevant to current context
// Fits in ~500 tokens — designed for system prompt injection
```

#### `get_lessons`
Returns lessons learned, filtered by relevance.

```typescript
get_lessons({
  topic: "packaging",            // optional — filter by category
  project: "codeseeker",         // optional — filter by project
  severity: "critical"           // optional — critical | important | moderate | minor
})
// Returns: aggregated lessons with details and evidence
```

#### `distill`
Manually trigger the intelligence layer to re-aggregate from raw memories. Normally runs automatically, but can be forced.

```typescript
distill({
  scope: "all"                   // all | profile | lessons | playbook
})
// Re-reads all raw memories, re-aggregates, updates profile.yaml + lessons.yaml + playbook.yaml
// Returns: { changes: ["Updated error_handling confidence from medium to high",
//                       "New lesson added: Snap strict confinement needs home plug"] }
```

#### `teach`
Directly add a lesson or preference without going through raw memory accumulation. For things you know upfront.

```typescript
teach({
  type: "rule",                  // rule | preference | lesson | interest
  content: "Always use semantic versioning with conventional commits",
  reason: "Enables automated changelog generation and clear release history"
})
// Immediately updates playbook.yaml and/or lessons.yaml
```

### How Distillation Works

The intelligence layer runs a distillation process that:

1. **Groups** raw memories by topic (semantic clustering)
2. **Counts** frequency — a preference mentioned once is "experimental", mentioned 5 times is "high confidence"
3. **Detects conflicts** — if memories contradict, surfaces for resolution via fact triples
4. **Compresses** — 47 individual error handling decisions → 1 profile entry with nuance
5. **Promotes** — Buffer memories accessed 2+ times promote to Working; Working memories accessed 5+ times or cross-project promote to Core
6. **Ages** — Buffer expires after 7 days; Working decays over months; Core never decays. Procedural memories skip straight to Core.
7. **Cross-pollinates** — patterns that appear across 3+ projects get promoted to global Core knowledge

### Background Consolidation Cycles

Chronicle runs background processes to keep memory healthy without user intervention:

| Cycle | Frequency | What It Does |
|-------|-----------|--------------|
| **Quick consolidation** | Every 30 minutes (during active sessions) | Promote buffer→working for re-accessed memories, merge near-duplicates, update access counts |
| **Deep distillation** | Every 12 hours (or on `distill()`) | Full intelligence layer update: re-cluster, resolve contradictions, update profile/lessons/playbook |
| **Decay sweep** | Daily | Expire untouched buffer memories, reduce confidence on stale working memories |
| **Audit** | Weekly | Check for contradictions across tiers, flag orphaned memories, generate health report |

These cycles are lightweight — the quick consolidation runs in <100ms on typical memory stores. Deep distillation may use an LLM call (via Claude CLI) for intelligent compression.

**Trigger conditions for on-demand distillation:**
- After every 10 new memories (batch)
- On explicit `distill()` call
- On `session_start()` if last distillation was >24h ago
- After a project reaches a milestone (Conclave checkpoint, CodeSeeker release)

### Context Injection Flow

When a session starts, Chronicle provides a **context packet** to the AI:

```
session_start("conclave")
  → Load playbook.yaml (global rules + conclave-specific)
  → Load relevant lessons (conclave + cross-project)
  → Load last session state
  → Load active preferences
  → Package into ~800 token context block
  → Inject into AI system prompt
```

The AI starts every session already knowing the developer's style, pitfalls to avoid, and where things left off.

## Data Model

### Memory Record

```typescript
interface Memory {
  id: string;                    // mem_<ulid>
  content: string;               // The knowledge itself
  category: MemoryCategory;
  memory_type: MemoryType;       // Determines decay behavior
  tier: MemoryTier;              // Current tier in three-tier model
  tags: string[];
  triggers: string[];            // Action triggers (e.g., "deploy", "publish")
  project?: string;              // null = cross-project
  namespace?: string;            // Project namespace for isolation
  confidence: Confidence;
  source: Source;
  created_at: string;
  last_accessed: string;
  access_count: number;
  promotion_count: number;       // Times promoted (buffer→working→core)
  decay_score: number;           // 0.0-1.0, decreases over time (except procedural)
  embedding: Float32Array;       // For semantic search
  related_memories: string[];    // Links to related memories
  superseded_by?: string;        // If this memory was updated/corrected
  fact_triple?: FactTriple;      // Structured fact representation
}

interface FactTriple {
  subject: string;               // e.g., "codeseeker"
  predicate: string;             // e.g., "database"
  object: string;                // e.g., "SQLite"
  valid_context?: string;        // When this fact applies
}

type MemoryTier = "buffer" | "working" | "core";

type MemoryType =
  | "semantic"       // Facts, definitions — slow decay
  | "episodic"       // Events, what happened — medium decay
  | "procedural"     // How-to, workflows — never decays, promotes to core immediately
  | "preference";    // Developer choices — slow decay

type MemoryCategory =
  | "solution"      // How to solve X
  | "decision"      // Why we chose X over Y
  | "preference"    // Developer prefers X
  | "insight"       // Pattern observed across projects
  | "bias"          // AI tendency to watch for
  | "gotcha";       // Trap/pitfall to avoid

type Confidence = "verified" | "likely" | "experimental";
type Source = "manual" | "auto-extracted" | "observed";
```

### Preference Record

```typescript
interface Preference {
  key: string;                   // Dot-notation: "react.state-management"
  value: string;                 // "zustand"
  context: string;               // When/why this applies
  strength: "strong" | "mild" | "default";
  project?: string;              // null = global
  overrides?: string;            // Global pref this project-level pref overrides
}
```

### Session Record

```typescript
interface Session {
  id: string;
  project: string;
  device?: string;
  started_at: string;
  ended_at?: string;
  files_touched: string[];
  decisions_made: string[];      // Links to decision memories
  tasks_completed: string[];
  tasks_pending: string[];
  summary: string;
}
```

## Integration Points

### With ForgeCraft
- ForgeCraft reads preferences when generating standards: "developer prefers strict TypeScript, functional style"
- ForgeCraft reads biases to add mitigations to instruction files
- ForgeCraft writes decisions about architecture choices to Chronicle

### With CodeSeeker
- CodeSeeker reads solutions when similar code patterns are found
- CodeSeeker writes insights about codebase patterns to Chronicle
- Cross-project search: "find all projects where we handle auth" queries both CodeSeeker index + Chronicle memory

### With Conclave
- Conclave reads session state on resume
- Conclave writes decisions at each checkpoint
- Conclave queries preferences before generating specs
- Conclave's roles can query solutions: "How did we implement X before?"

### With Claude Code (direct)
- Auto-injection: Before every prompt, relevant preferences and biases are injected into context
- Post-session: Key decisions and solutions auto-extracted and stored

## Auto-Extraction (Passive Learning)

Chronicle doesn't just store what you tell it. It observes:

1. **Decision Detection**: When a conversation includes "let's use X instead of Y" or "I prefer X", auto-extract as a decision/preference
2. **Solution Detection**: When code solves a non-trivial problem, offer to save it
3. **Bias Detection**: When Claude makes the same mistake across projects, auto-flag it
4. **Pattern Detection**: When similar solutions appear in 3+ projects, surface as an insight

This is opt-in — Chronicle suggests, user confirms.

## Privacy & Security

- All data stored locally in `~/.chronicle/`
- No cloud sync (unless user explicitly configures it)
- No data leaves the machine
- Memories can be exported/imported as JSON for backup
- Per-project data can be deleted independently

## Design Principles

Inspired by cognitive science memory models and systems like engram-rs, but built for a different purpose:

1. **Three-tier with purpose** — Buffer/Working/Core mirrors human short-term → long-term memory. Unlike simple TTL caches, promotion is based on demonstrated value (re-access, cross-project relevance).
2. **Memory types that age differently** — Procedural knowledge ("how to publish to npm") is too expensive to relearn, so it never decays. Episodic knowledge ("yesterday's deploy failed") fades naturally.
3. **Contradiction-aware** — Fact triples enable structured queries and automatic conflict detection. No silent overwriting of existing knowledge.
4. **Trigger-based safety** — Tag critical memories with action triggers so they surface automatically before risky operations, without requiring the user to remember to check.
5. **Token-conscious** — Every output is designed for AI context windows. Session recovery, playbooks, and context packets all respect token budgets.
6. **Intelligence over storage** — Raw memories are the inputs, but the value is in distilled artifacts (profile, lessons, playbook). Chronicle gets smarter, not just bigger.
7. **Minimal footprint** — SQLite + local embeddings. No Docker, no external services. Single `npx` to install.

## Tech Stack

- TypeScript, MCP SDK
- SQLite (better-sqlite3) for storage — single file, no server, ~9MB baseline
- Local embedding model (same approach as CodeSeeker) for semantic search
- FTS5 for full-text search
- No external dependencies at runtime
- Target: <100ms for recall, <2s for session_start with full context injection

## CLI Commands

```bash
chronicle serve --mcp              # Start as MCP server
chronicle status                    # Show memory stats
chronicle search "query"            # Search memories from terminal
chronicle export --project=all      # Export all memories as JSON
chronicle import memories.json      # Import from backup
chronicle prune --older-than=1y     # Clean old, unused memories
```

## Install

```bash
# Add to any AI assistant
claude mcp add chronicle -- npx -y chronicle-mcp

# Or via npm
npm install -g chronicle-mcp
codeseeker install --vscode  # if integrated with CodeSeeker's installer
```

## Success Metrics

- **Cold start time**: < 2 seconds to load relevant context for a new session
- **Recall accuracy**: Top-3 results contain the relevant memory 90%+ of the time
- **Cross-project hit rate**: Solutions from project A successfully applied to project B
- **Bias mitigation**: Tracked biases recur less frequently over time
- **Session continuity**: Users can resume from phone and be productive within 1 message
