---
id: ROADMAP
type: status
status: active
tier: T1
properties: [bounded, auditable]
obligations: 3
depends_on: [GS-ASSESSMENT, SPEC]
---

# Roadmap — chronicle

> Each item is **one session**, bound to a prompt that carries its own references, scope and
> acceptance test. A roadmap line like *"build the connection system"* forces the agent to
> reconstruct scope at execution time, which is exactly where it invents. The load-bearing line
> in every bound prompt is **what NOT to touch**.
>
> This file replaced a generated stub whose items read "Implement UC-001: Implement primary use
> case" and which pointed at eight session-prompt files that never existed. The items below are
> the treatment plan in `docs/gs-assessment.md`, which is derived from measured gaps.
>
> **Every RM row MUST resolve to a prompt file that exists** — `scripts/gs-cascade-check.mjs`
> step 4 reports an orphan reference otherwise.

Status: `pending` | `in-progress` | `done`

---

## Phase 1 — Make every claim admissible (P1)

Nothing here adds a feature. It makes the existing claims true, which is the precondition for
anything after it.

| ID | Title | Depends on | Status | Prompt |
|---|---|---|---|---|
| RM-101 | Run every gate and commit the execution records | — | **done** 2026-09-10 | `docs/session-prompts/RM-101.md` |
| RM-102 | Test `sync.ts` — the five assertions named in EDR-003 | RM-101 | **done** — 15 tests | `docs/session-prompts/RM-102.md` |
| RM-103 | Test `coordination-service.ts` — `computePriorityRanks` first, cycle included | RM-101 | **done** — 45 tests | `docs/session-prompts/RM-103.md` |
| RM-104 | Benchmark NFR-02/03/04 into `docs/evidence/` | RM-101 | **pending — next** | `docs/session-prompts/RM-104.md` |
| RM-105 | Add `server.json` and publish to the MCP Registry, or strike NFR-08 | — | **half done** — file exists, not submitted | `docs/session-prompts/RM-105.md` |
| RM-106 | Run `pnpm audit --prod --audit-level=high` — the one gate never executed | — | pending | _not written — generate with the format below_ |
| RM-107 | Open a v11-written database with v13 (ADR-015 is verified for new DBs only) | — | pending | _not written — generate with the format below_ |
| RM-108 | Unit-test `src/mcp/server.ts` — 581 of 1,684 mutants, 0% covered | — | pending | _not written — generate with the format below_ |

**Exit criterion for Phase 1:** no line in `Status.md` reads *unrun*, and `docs/evidence/` holds
a green test run, a coverage number and a first mutation score.

**Status 2026-09-10:** three of five done, plus three items the pass surfaced. `docs/evidence/`
holds a green run (119/119), a coverage number (41.17%) and a first MSI (20.67%) — so the original
exit criterion is met for the gates. What keeps Phase 1 open is RM-104: the latency NFRs in
spec §5 are still the only wholly unmeasured claims in the repository.

## Phase 2 — The gate corpus becomes provenance-bearing (P2 · Defended 1 → 2)

| ID | Title | Depends on | Status | Prompt |
|---|---|---|---|---|
| RM-201 | Give every gate its originating incident (`provenance`) | RM-101 | pending | _not written — generate with the format below_ |
| RM-202 | Add `expires_at` to all eight exemptions, or remove them | — | **done** — 9 exemptions, all with `expiresAt` | _n/a_ |
| RM-203 | Branch protection on `master`: required checks, no direct push, linear history | RM-101 | pending | _not written — generate with the format below_ |
| RM-204 | Wire the TDD phase gate — block a `feat:` with no preceding `test:` | RM-101 | pending | _not written — generate with the format below_ |

## Phase 3 — Close the loop from runtime back to spec (P3 · Executable 0 → 2)

| ID | Title | Depends on | Status | Prompt |
|---|---|---|---|---|
| RM-301 | Execute UC-001…UC-009 against a live MCP client; record every result | RM-102, RM-103 | pending | _not written — generate with the format below_ |
| RM-302 | Clean-machine `npx -y chronicle-mcp` test on a Node matrix (UC-008) | RM-105 | pending | _not written — generate with the format below_ |
| RM-303 | Audit each ADR against the code it governs | RM-301 | pending | _not written — generate with the format below_ |

## Phase 4 — Structural debt

| ID | Title | Depends on | Status | Prompt |
|---|---|---|---|---|
| RM-401 | Split `coordination-service.ts` at the four seams in EDR-004 | RM-103 | pending | _not written — generate with the format below_ |
| RM-402 | Spec-map for `spec.md` once it passes ~500 lines (426 now) | — | pending | _not written — generate with the format below_ |
| RM-403 | Migration for rows carrying `memory_type = 'session'` (ADR-012 §2) | RM-101 | pending | _not written — generate with the format below_ |
| RM-404 | FTS5 recall, if RM-104 shows NFR-03 missed (ADR-014 §3) | RM-104 | pending | _not written — generate with the format below_ |

## Phase 5 — Deferred features

Only after Phases 1–3. Each of these is `[SPECIFIED]` in `docs/spec.md §4`, and adding a feature
while the two largest existing units are untested is how this repository got here.

| ID | Title | Depends on | Status | Prompt |
|---|---|---|---|---|
| RM-501 | F10 JanitorService — LLM-assisted consolidation | Phase 3 | pending | `docs/session-prompts/RM-004.md` |
| RM-502 | F8 intelligence layer reachable through the MCP surface + the three YAML artifacts | Phase 3 | pending | _not written — generate with the format below_ |
| RM-503 | F4 solution library / F9 insights engine dedicated surfaces | RM-502 | pending | _not written — generate with the format below_ |

---

## Superseded items

`RM-001`, `RM-002`, `RM-003` were generated stubs ("Implement primary use case") with no
identifiable scope; `RM-010`…`RM-022` pointed at prompt files that were never written. All are
superseded by the phases above. `RM-004` (JanitorService) is a genuine bound prompt and is
retained as RM-501.

---

## The bound-prompt format

Every prompt file MUST carry all five parts. A prompt missing **Scope → NOT IN SCOPE** is not
bound, and the session will drift into whatever looks easiest:

```markdown
## [ID] — [task name]
**Load:** [exact artifacts to read — and what NOT to load]
**Scope:** [what to build — and, explicitly, what NOT to touch]
**Acceptance:**
- [ ] [specific, verifiable criterion]
- [ ] full suite passes
- [ ] exercised at the real boundary (MCP/CLI), not only in unit tests
**Commit:** feat(scope): [description]
```

Facing a failing test, an agent's path of least resistance is to edit the production code until
the test passes. A `NOT IN SCOPE: implementation code` line makes that path unreachable.

_Derived from `docs/gs-assessment.md`, 2026-09-10. Supersedes the 2026-04-06 generated roadmap._
