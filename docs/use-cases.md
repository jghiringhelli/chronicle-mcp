id: UC
type: use-case
status: active
tier: T1
properties: [executable, verifiable]
obligations: 9
generative_execution: red
depends_on: [SPEC, ADR-011]

---

# Chronicle — Use Cases / Behavioral Contracts

These use cases are the acceptance criteria for Chronicle. Each UC maps to a reachable action
on the real MCP surface and, where the status line says so, to an automated test.

**The surface is three tools, not twenty** (ADR-011): `chronicle`, `session`, `axon`, each
dispatching on an `action`. The capability names in `docs/spec.md §4` are not tool names. This
file was written against the flat surface and has been corrected; the calls below are the ones
a client can actually make.

**Each UC carries a status line:**

- **green** — an automated test pins this contract.
- **red** — the capability is reachable but no test pins it.
- **unrun** — the contract has a latency or environment claim with no execution record under
  `docs/evidence/`.
- **blocked** — the capability it describes is not built (`[SPECIFIED]` in spec §4).

A timing expectation is never "green" on inspection alone: it needs a benchmark. Until
`docs/evidence/` holds one, every latency line below reads *unrun*.

---

## UC-001: Store a memory across a session boundary

**Actor:** AI assistant (via MCP)
**Precondition:** Chronicle MCP server running. No prior memories for project "my-app".

**Steps:**
1. AI calls `chronicle(action: "remember", content: "Railway does not persist /tmp across deploys", memory_type: "semantic", project: "my-app")`
2. AI session ends. New session starts.
3. AI calls `chronicle(action: "recall", query: "railway deploy file storage", project: "my-app")`

**Expected outcome:**
- Step 1 MUST return `{ id, tier: "working", weight: 0.5 }` — `semantic` seeds into **working**,
  not `buffer` (`DEFAULT_TIERS`, ADR-012). The earlier `buffer` expectation here was wrong, and
  a test written to it would have pinned the wrong contract.
- Step 3 MUST return the stored memory, reinforced by `RECALL_HIT` (+0.15).
- Step 3 matches on the word `railway` appearing in the content. Matching is OR across words
  and ranking is by `weight` alone, so a query sharing no word with the stored text MUST be
  expected to miss (ADR-014, EDR-002).
- Cold start of new session < 200ms (NFR-02)
- `recall` response < 50ms (NFR-03)

**Status:** red for the contract (no test), unrun for both latency lines.

---

## UC-002: Architectural decision survives context reset

**Actor:** Developer (explicitly) or AI assistant
**Precondition:** Chronicle running.

**Steps:**
1. Developer calls `chronicle(action: "remember", memory_type: "architectural", content: "chose better-sqlite3 over Prisma — synchronous API, no migration runner; rejected Prisma (4MB bundle, async overhead)", project: "my-app", confirmed: true)`
2. Three months later, a new AI session starts for the same project.
3. AI calls `chronicle(action: "recall", query: "database", project: "my-app", memory_types: ["architectural"])`

**Expected outcome:**
- Step 1 MUST store the memory in Core with `decayRate: 0.00`.
- Step 3 MUST return the decision with its reasoning intact.
- Weight MUST NOT have decayed after any number of decay passes (EDR-001: the
  `decayRate === 0` early return).

**Surface note.** `remember_decision()` and `project_context()` do not exist. The
`architectural` memory type carries this; the dedicated cross-project retrieval of
`docs/spec.md §F6` is [PARTIAL] — the rows are reachable, the cross-project ranking is not.

**Status:** red for the retrieval contract; green for the zero-decay invariant
(`tests/unit/domain/memory.test.ts`).

---

## UC-003: Trigger fires before a risky action

**Actor:** AI assistant
**Precondition:** A memory exists with a `deploy` trigger.

**Steps:**
1. Memory created, then `chronicle(action: "trigger", id: <memory_id>, trigger: "deploy", severity: "critical")`
2. AI calls `chronicle(action: "check", trigger: "deploy", project: "my-app")`

**Expected outcome:**
- Step 2 MUST return the memory with `severity: "critical"`.
- `weight` MUST be boosted by `TRIGGER_HIT` (+0.20), the highest non-confirmed boost — a trigger
  firing is strong evidence the memory matters.
- Response time < 50ms.

**Status:** red (no test). This is the highest-value untested contract in the file: the whole
point of a trigger is that it fires *before* a destructive action, and nothing currently proves
it does.

---

## UC-004: Session recovery from interrupted context

**Actor:** AI assistant after a crash/context reset
**Precondition:** A prior session was started with `session_start()` but not ended.

**Steps:**
1. AI calls `session(action: "recover", project: "my-app")`

**Expected outcome:**
- MUST return the active session's tasks, pending decisions and touched files, or a clear
  "no active session" result — never an error for the empty case.

**Surface note.** The `token_budget` / `depth` progressive-compression behaviour in
`docs/spec.md §F7` is **not implemented**: `session(action: "recover")` takes `project` or `id`
only. The compression ladder (drop file contents → summarise decision chains → key bullets) is
[SPECIFIED].

**Status:** red for the base contract; blocked for the compression ladder.

---

## UC-005: Cross-project solution search

**Actor:** AI assistant working on a new project
**Precondition:** A solution was saved in project "old-app".

**Steps:**
1. In project "old-app": `chronicle(action: "remember", memory_type: "procedural", content: "Railway env var not loading at build time — echo it in the build command to confirm injection timing", tags: ["typescript", "railway"])`
2. In project "new-app": `chronicle(action: "recall", query: "environment variable build")` — with
   **no** `project` filter, which is what makes recall cross-project.

**Expected outcome:**
- Step 2 MUST return the procedural memory stored under a different project.
- It MUST be ranked by `weight`, **not** by semantic similarity — the spec's
  "ranked by semantic similarity" is not what ships (ADR-014). A query sharing no word with the
  stored text MUST be expected to miss.
- Cross-project search < 50ms up to 10k memories (NFR-03).

**Surface note.** `save_solution()` / `find_solution()` do not exist; the `solutions` table does.
The capability is the `procedural` memory type plus an unfiltered recall. §F4 is [SPECIFIED].

**Status:** red for the contract, unrun for the latency line, blocked for §F4's dedicated surface.

---

## UC-006: Intelligence layer distillation

**Actor:** Chronicle background job (every 12h)
**Precondition:** At least 10 memories stored across multiple types.

**Steps:**
1. Distillation runs at a session boundary (`src/services/distill.ts`).
2. AI asks for the condensed rules.

**Expected outcome (as specified):**
- `profile.yaml`, `lessons.yaml`, `playbook.yaml` updated under `~/.chronicle/`
- the playbook returns condensed rules ≤ 500 tokens
- distillation completes < 500ms for 50k memories

**Status: blocked.** The distillation *service* exists and runs at session boundaries, but
nothing in it is reachable through the MCP surface, and the three YAML artifacts are not
emitted. `docs/spec.md §3.3` and §F8 are [SPECIFIED]/[PARTIAL]. This UC MUST NOT be described
as available.

---

## UC-007: Decay reduces weight of old episodic memory

**Actor:** Chronicle background decay job
**Precondition:** Episodic memory with `weight: 0.8` not accessed for 14 days.

**Steps:**
1. The decay pass runs at session end, 14 days after last access (`decayRate: 0.10`).

**Expected outcome:**
- `weight ≈ 0.8 × e^(−0.10 × 14) ≈ 0.197`
- The memory MUST remain in storage — decay lowers rank, it never deletes.
- `procedural`, `architectural` and `insight` memories MUST be unaffected (`decayRate: 0.00`),
  and MUST also be exempt from any consolidation pass.
- Decay is keyed on **days since last access**, never since creation — an old memory that is
  still used stays hot (EDR-001).

**Status:** green (`tests/unit/domain/memory.test.ts` pins the formula and the zero-decay
early return).

---

## UC-008: Publish and cold-start via npx

**Actor:** Developer (new machine, no prior install)

**Steps:**
1. Developer configures an MCP client with the command `npx -y chronicle-mcp`.
2. The assistant starts a session and calls `chronicle(action: "remember", ...)`.

**Expected outcome:**
- Chronicle MUST start and serve on stdio with **no** configuration beyond that command: no
  config file, no API key, no model download. This is why recall is dependency-free keyword
  matching rather than mandatory vector similarity (ADR-014 §1).
- Cold start < 200ms after the package is resolved (NFR-02).
- The first `remember` MUST succeed and return `{ id, tier, weight }`, creating
  `~/.chronicle/chronicle.db` on the way.
- The absence of `railwayUrl` MUST leave every operation unchanged and MUST NOT raise
  (NFR-09, ADR-010 §3).
- The client's Node major MUST be one for which `better-sqlite3` publishes a prebuild
  (`>=20 <24`); outside that range the install fails at runtime with a bindings error
  (`.claude/ledger.md`).

**Status:** unrun. Never executed as a clean-machine test, which is the one test this UC is
about — and the Node-range constraint means it MUST be run on a matrix, not one machine.

---

## UC-009: Team coordination — work is decomposed, assigned and merge-gated

**Actor:** A small team running Generative Specification, through one member's assistant
**Precondition:** Chronicle running with `teamId` configured. Contributors registered.

**Steps:**

1. `axon(action: "contributor_add", ...)` for each team member, with a role
   (`specwright` | `builder` | `merger` | `verifier` | `watcher`).
2. `axon(action: "decompose", ...)` over a body of work, each package citing the spec section it
   derives from.
3. `axon(action: "assign", project: "my-app")`
4. `axon(action: "complete", ...)` when the work lands.
5. `axon(action: "request_merge", ...)` then `axon(action: "resolve_merge", ...)`.

**Expected outcome:**

- Step 2 MUST rank packages by transitive dependents — the package that unblocks the most
  downstream work ranks first (EDR-004). A package MUST carry its `spec_section`; unanchored
  work is what this layer exists to prevent.
- Step 3 MUST return the highest-ranked *unblocked* package, the most available contributor for
  its required role, and the branch name the contributor is required to use
  (`feature/<contributor>/<package>`, or `merge/` / `spec/` by role). It MUST return `null`
  — never throw — when nothing is assignable.
- Step 4 MUST free the contributor and promote every downstream package whose dependencies are
  now satisfied. No contributor may remain `busy` with no active assignment.
- Step 5 MUST record the gate verdict passed in by the caller. `axon` MUST NOT compute it and
  MUST NOT execute anything — enforcement is ForgeCraft's job (`.claude/core.md`).
- With no `teamId` configured, every `axon` action MUST be inert rather than failing.

**Status: red.** `coordination-service.ts` is 771 lines with zero tests. This UC was written
*after* the code, to close the gap ADR-010 records: the team surface shipped with no behavioural
contract at all, which made it ghost code under the cascade check. Writing the UC is half the
fix; the tests named in EDR-004 are the other half.
