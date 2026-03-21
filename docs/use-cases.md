# Chronicle — Use Cases / Behavioral Contracts

These use cases define the acceptance criteria for Chronicle v1. Each UC maps to at least one MCP tool and one automated test.

---

## UC-001: Store a memory across a session boundary

**Actor:** AI assistant (via MCP)
**Precondition:** Chronicle MCP server running. No prior memories for project "my-app".

**Steps:**
1. AI calls `remember("Railway does not persist /tmp across deploys", memoryType: "semantic", project: "my-app")`
2. AI session ends. New session starts.
3. AI calls `recall("railway deploy file storage", project: "my-app")`

**Expected outcome:**
- Step 1 returns `{ id, tier: "buffer", weight: 0.5 }`
- Step 3 returns the stored memory ranked first, with `tier: "buffer"` or `"working"` if accessed previously
- Cold start of new session < 200ms
- `recall()` response < 50ms

---

## UC-002: Architectural decision survives context reset

**Actor:** Developer (explicitly) or AI assistant
**Precondition:** Chronicle running.

**Steps:**
1. Developer calls `remember_decision("chose better-sqlite3 over Prisma", context: "...", alternatives_considered: [...], consequences: [...])`
2. Three months later, new AI session starts for the same project.
3. AI calls `project_context("my-app", "database")`

**Expected outcome:**
- Step 1 stores memory in Core tier immediately (`decayRate: 0.00`)
- Step 3 returns the ADR-level decision with alternatives and consequences
- Memory weight has not decayed

---

## UC-003: Trigger fires before a risky action

**Actor:** AI assistant
**Precondition:** A memory exists with a `deploy` trigger.

**Steps:**
1. Memory created: "Redis eviction policy resets on Railway deploy". `set_trigger(memory_id, trigger: "deploy", severity: "critical")`
2. AI calls `check_triggers(action: "deploy", project: "my-app")`

**Expected outcome:**
- Step 2 returns the memory with `severity: "critical"`
- `weight` is boosted by +0.20 (trigger reinforcement)
- Response time < 50ms

---

## UC-004: Session recovery from interrupted context

**Actor:** AI assistant after a crash/context reset
**Precondition:** A prior session was started with `session_start()` but not ended.

**Steps:**
1. AI calls `session_recover(project: "my-app", token_budget: 2000, depth: "summary")`

**Expected outcome:**
- Returns active tasks, pending decisions, and files being touched from the last session
- Response compressed to fit within `token_budget`
- Progressive compression: file contents dropped first, then decision chains summarised, then key bullets only

---

## UC-005: Cross-project solution search

**Actor:** AI assistant working on a new project
**Precondition:** A solution was saved in project "old-app".

**Steps:**
1. In project "old-app": `save_solution(problem: "Railway env var not loading at build time", solution: "echo in build command to confirm injection timing", language: "typescript")`
2. In project "new-app": `find_solution(problem: "environment variable not available in build", language: "typescript")`

**Expected outcome:**
- Step 2 returns the solution from "old-app" ranked by semantic similarity
- Cross-project search completes < 50ms for up to 10k solutions

---

## UC-006: Intelligence layer distillation

**Actor:** Chronicle background job (every 12h)
**Precondition:** At least 10 memories stored across multiple types.

**Steps:**
1. `distill(scope: "all")` called (or triggered automatically after 12h)
2. AI calls `get_playbook(project: "my-app")`

**Expected outcome:**
- `profile.yaml`, `lessons.yaml`, `playbook.yaml` updated
- `get_playbook()` returns condensed rules ≤ 500 tokens
- Distillation completes < 500ms for 50k memories

---

## UC-007: Decay reduces weight of old episodic memory

**Actor:** Chronicle background decay job
**Precondition:** Episodic memory with `weight: 0.8` not accessed for 14 days.

**Steps:**
1. Daily decay job runs for 14 days on this memory (`decayRate: 0.10`)

**Expected outcome:**
- After 14 days: `weight ≈ 0.8 × e^(-0.10 × 14) ≈ 0.196`
- Memory remains in storage (not deleted) but ranks lower in `recall()` results
- Procedural and Architectural memories are unaffected (decayRate: 0.00)

---

## UC-008: Publish and cold-start via npx

**Actor:** Developer (new machine, no prior install)

**Steps:**
1. Developer configures MCP client with command: `npx -y chronicle-mcp`
2. AI assistant starts a new session and sends a `remember()` call

**Expected outcome:**
- npx installs and starts Chronicle in < 200ms cold start
- First `remember()` call succeeds and returns `{ id, tier, weight }`
- No configuration required beyond the npx command
