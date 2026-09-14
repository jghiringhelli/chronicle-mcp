---
id: PRD
type: spec-section
status: active
tier: T1
properties: [self-describing]
obligations: 0
depends_on: [SPEC]
---

# PRD — Chronicle

> **Scope of this document.** Why Chronicle exists, for whom, and how we know it worked.
> It deliberately states **no behaviour**: behaviour lives in `docs/spec.md`, which is the
> single authoritative functional specification (ADR-013). If you are looking for what a tool
> does, you are in the wrong file.
>
> This file replaces an unfilled ForgeCraft template that sat in the `functional_spec` cascade
> slot — so the cascade reported a satisfied step over a document whose title was still the
> scaffold's placeholder and whose functional requirements were still bracketed scaffold holes.
> `scripts/gs-cascade-check.mjs` step 3 now fails the build on that class of stub.

## Background and context

An AI coding assistant is a **stateless reader**. Every session begins with no memory of the
last one: not the architectural decisions, not the developer's preferences, not the two hours
spent last Tuesday discovering that a platform does not persist `/tmp` across deploys.

The cost is paid three times. The developer re-explains. The assistant re-derives — and,
lacking the reasoning behind a deliberate trade-off, sometimes "improves" it into a bug. And
the same class of mistake recurs, because nothing in the loop remembers that it was already
corrected.

Existing answers are partial. A project constitution (`CLAUDE.md`) carries *project* rules but
not the developer's accumulated judgment, and it does not grow on its own. Vendor session
memory is per-vendor and per-project, captures mostly recent events, and is not portable
across the assistants one person actually uses in a week.

Chronicle is the missing layer: durable, local, cross-project, assistant-agnostic memory, with
the *reasoning* stored beside the decision.

## Stakeholders

| Role | Who | What they need from it |
|---|---|---|
| Owner | PragmaWorks (Juan Carlos Ghiringhelli) | A working memory layer for the MCP stack, alongside ForgeCraft (enforcement) and CodeSeeker (retrieval) |
| Primary user | An individual developer working with AI assistants daily, across several projects | Not to re-explain their own stack and decisions every session |
| Secondary user | A small team running the Generative Specification method | Shared coordination state and cross-developer patterns (the `axon` layer, ADR-010) |
| Consumer | Any MCP-capable client — Claude Code, Copilot CLI, Cursor, Gemini | A stdio server that works with no configuration beyond the command |
| Affected | The assistant itself | Context it can retrieve instead of re-derive |

## Users and the jobs they are doing

- **US-001** — As a developer starting a session on a project I last touched weeks ago, I want
  the assistant to already know the decisions I made, so I do not re-explain them.
- **US-002** — As a developer who has corrected the same AI mistake three times, I want the
  correction recorded once and honoured thereafter.
- **US-003** — As a developer about to deploy, I want to be warned about what broke the last
  time I deployed this thing, *before* I run the command — not after.
- **US-004** — As a developer starting a new project, I want the solutions I found in the old
  one to be reachable, without remembering where they came from.
- **US-005** — As a developer who switches between assistants, I want one memory store behind
  all of them, not a silo per vendor.
- **US-006** — As a developer resuming after a crash or a context reset, I want to know what I
  was in the middle of.
- **US-007** — As a small team running GS, I want to see who owns which work package and what
  is blocking a merge, without a standup.

Each maps to a behavioural contract in `docs/use-cases.md` (UC-001…UC-009), and each UC names
the acceptance criteria.

## Requirements

Functional requirements are the F-sections of `docs/spec.md §4`, each carrying a status marker
([SHIPPED] / [PARTIAL] / [SPECIFIED]). Non-functional requirements are `docs/spec.md §5`,
NFR-01…NFR-10, each carrying a verification status. Both are stated there once rather than
restated here: a requirement with two homes drifts.

## Success metrics

| Metric | Target | How it is measured | Status |
|---|---|---|---|
| Cold-start context | A session on a known project starts with its Core memories loaded, zero prompting | `session(action: 'start')` returns them | shipped, unmeasured |
| Recurrence | A correction recorded once does not recur in a later session | manual observation across sessions | not instrumented |
| Retrieval cost | Retrieving stored context costs fewer tokens than re-deriving it | token accounting on a matched task pair | not measured |
| Adoption friction | Install is one MCP registration, no config file | `npx -y chronicle-mcp` (NFR-01) | shipped, unverified |
| Trust | Every published performance claim has an execution record | `docs/evidence/` | **0 of 8 NFRs** have one |

The last row is the honest headline, and it is deliberately first among equals: Chronicle is a
tool about remembering reliably, so a performance claim it cannot evidence is a claim it should
not make. Closing that row is the current priority (`docs/gs-assessment.md`).

## Out of scope

See `docs/spec.md §0` for the permanent boundaries (not code search, not enforcement, not
execution, not hosted, not multi-tenant) and `§6` for deferred work.

## Open questions

- **Q1.** Does the `coordination` type stay folded into `chronicle-mcp` after the team
  experiment concludes, or move to its own distributable? ADR-010 chose folding *for the
  experiment*; the decision is due a review once the experiment reports.
- **Q2.** Is lexical recall good enough in practice, or is FTS5 (ADR-014 §3) on the critical
  path? Unanswerable until recall quality is measured on a real store.
- **Q3.** Does the three-artifact intelligence layer (`profile` / `lessons` / `playbook`,
  spec §3.3) earn its complexity, given that `recall` already returns ranked memories?
- **Q4.** Should `postgres` become an optional peer dependency, so the ~95% of installs that
  never sync stop carrying it?
