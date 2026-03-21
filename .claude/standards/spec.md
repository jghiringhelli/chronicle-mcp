<!-- ForgeCraft sentinel: spec | 2026-03-21 | npx forgecraft-mcp refresh . --apply to update -->

## Active Release Phase: development

Your current phase determines which test gates are **required now**, not advisory.
The full taxonomy and trigger mapping are in the Testing section above.
Read your phase row below and apply every requirement listed.

| Phase | Required now — blocking | Not required yet |
|---|---|---|
| **development** | Unit + integration + lint + tsc --noEmit + npm audit (no HIGH/CRITICAL) | DAST, load/stress, penetration, mutation score gate |
| **pre-release / staging** | All development requirements + smoke → DAST (OWASP ZAP / Burp Suite) + load test at 2× peak (k6 / Locust) + chaos/resilience (Toxiproxy) + mutation score ≥ 80% on changed code | Manual penetration test, full a11y audit |
| **release-candidate** | All staging requirements + manual penetration test (OWASP Top 10, JWT vectors, BOLA/IDOR) + full a11y audit (if UI) + compatibility matrix + mutation score ≥ 80% overall + zero unresolved HIGH/CRITICAL CVEs | Production canary |
| **production** | Canary deploy + automatic rollback on error rate spike + synthetic health probes + incident runbook verified | — |

**Current active phase: `development`**

> If the phase is `pre-release` or `release-candidate`:
> Hardening tests (load, DAST, penetration) are REQUIRED in this session, not deferred.
> Do not proceed to merge without completing the required gate for your phase.
> The Testing section above maps each gate to its tooling and target duration.

## Artifact Grammar — The Generative Specification

A system achieves generative specification when any AI coding assistant, given access to
its artifacts alone, can: correctly identify what should and should not change for any
requirement; produce output conforming to architectural, quality, and behavioral contracts;
and detect when any existing artifact violates those contracts.

Each artifact type below is a production rule in the system's grammar. Absent artifacts
are specification gaps. A gap is not a documentation debt — it is an architecturally
incomplete grammar.

| Artifact | Function in the System | Required |
|---|---|---|
| **Architectural constitution** (`CLAUDE.md` / `AGENTS.md` / `.cursor/rules/` / `.github/copilot-instructions.md`) | Defines what is and is not a valid sentence in this system. Governs every AI interaction. Agent-agnostic concept; filename is agent-specific. | Core |
| **Architecture Decision Records (ADRs)** | Documents why the grammar evolved. Prevents the AI from "correcting" intentional decisions that appear suboptimal without context. | Core |
| **C4 diagrams / structural diagrams** (PlantUML, Mermaid) | The parsed structural representation: system context, container topology, component composition. Static structure at a glance for any agent entering the codebase. | Recommended |
| **Sequence diagrams** | Fix the inter-component protocol: which call, in which order, with which contracts. A sequence diagram specifying that auth precedes data fetch is an unambiguous ordering constraint. The AI has two valid sentences: the one matching the diagram, and deviations from it. | Recommended |
| **State machine diagrams** | Enumerate every valid state and every valid transition. Directly generate state transition test cases and user-facing modal behavior documentation. | When system has states |
| **User flow diagrams** | Define the expected journey from entry to outcome. Simultaneously the script for every E2E test in that flow and the user journey narrative for the manual. | Recommended |
| **Use cases** | Single, precise descriptions of an interaction. One use case seeds three artifacts: implementation contract, acceptance test, user documentation. See `use-case-triple-derivation`. | Recommended |
| **Schema definitions** (DB, API, events) | The vocabulary of the system with constraints formally stated. Types, relations, validation rules, value ranges. | Core |
| **Living documentation** (derived) | OpenAPI from decorators/schemas; TypeDoc/JSDoc auto-published; Storybook from component specs; README sections from centralized specs. Documentation maintained separately from code drifts — documentation derived from the same artifacts cannot be wrong in a way the code is right. | Recommended |
| **Naming conventions** (explicit in constitution) | Semantic signal at every token. `calculateMonthlyCostPerMember` carries domain, operation, unit, scope. `processData` carries nothing. Names are grammar; the AI propagates every name it reads. | Core |
| **Package and module hierarchy** | Communicates responsibility and ownership through structure. The location of a file is a claim about what it is. | Core |
| **Conventional atomic commits** | Typed corpus: `feat(billing): add prorated invoice calculation` has a part of speech, scope, and semantic payload. The git log is a readable history of how the grammar evolved and why. | Core |
| **Test suite (adversarial)** | Each test is a specification assertion AND adversarial challenge. The suite is a continuously-running audit and standing challenge to the implementation. Written against interfaces, not implementations. | Core |
| **Commit hooks and quality gates** | Malformed input is structurally rejected before entering the system. Certain classes of mistake are architecturally unreachable. | Core |
| **Status.md** | Session bridge: current implementation state, what was completed, where the session stopped, what was tried. The Auditable property requires both that the record exists and that the next session begins by reading it. | Core |
| **MCP tools and environment tooling** | The tools available to the agent define what operations are possible. Bounded tool access is bounded agency. Specification governs not just code but the system that can act. | Optional |

### The Six Properties (self-test)
A generative specification satisfies all six. Use as an inspection checklist:
- **Self-describing**: Does the system explain its own architecture, decisions, and conventions from its own artifacts?
- **Bounded**: Does every unit have explicit scope and seams? Is the context window to modify any unit predictably bounded?
- **Verifiable**: Can the correctness of any output be checked without human judgment? Is verification automatic, fast, and blocking?
- **Defended**: Are destructive operations structurally prevented (hooks, gates) rather than merely discouraged?
- **Auditable**: Is the current state and full history recoverable from artifacts alone? Would the AI treat an intentional decision as a defect to correct?
- **Composable**: Can units be combined without unexpected coupling? Can the AI work on any unit in isolation because isolation is structural?

> **GS Protocol on demand:** call `get_reference(resource: guidance)` for the full
> session-loop procedure, context-loading strategy, incremental cascade, bound roadmap
> format, and diagnostic checklist. These procedures are NOT inlined here to preserve
> the token budget of this instruction file.

## Names Are Production Rules

In a context-sensitive system, naming is not style. It is grammar.

A function named `getUser` in a domain model that talks to a database is an architecture
violation the compiler will not catch, the linter may not catch, and a human reviewer
will tolerate — but the AI will propagate. The name signals layer; the AI reads the signal.

### Layer-Scoped Naming Vocabulary
Enforce consistent naming by layer. Deviations are architecture violations.

| Layer | Allowed verbs / patterns | Examples |
|---|---|---|
| **Repository** | `find`, `save`, `delete`, `exists`, `count` | `findUserByEmail`, `saveOrder`, `deleteById` |
| **Service** | `get`, `create`, `update`, `process`, `calculate`, `validate` | `getUserProfile`, `createInvoice`, `calculateMonthlyCost` |
| **Controller / Handler** | `handle`, `on` + event name | `handleCreateUser`, `onPaymentReceived` |
| **Domain model** | noun + computed property / behavior | `Invoice.totalWithTax`, `User.isExpired` |
| **Event** | past tense, domain noun | `UserRegistered`, `OrderShipped`, `PaymentFailed` |
| **DTO** | noun + `Request` / `Response` or `Dto` | `CreateUserRequest`, `UserProfileResponse` |
| **Interface / Port** | capability noun | `UserRepository`, `EmailSender`, `PaymentGateway` |

### Naming as Technique Transport
What a practitioner names in a specification, the AI knows how to apply.
Every technique in the model's training corpus becomes available to any system whose
specification names it. A specification that says "analyze legal arguments" receives
legal analysis. A specification that names prosody, argumentation theory, fallacy
classification, and deontic modal logic receives a specialist instrument calibrated
to the domain. The naming cost is one word. The activation cost of the AI's knowledge
of the field is zero once the name appears.

Name patterns, techniques, and domain frameworks explicitly in the architectural
constitution. The specification is a technique registry whose scope is the full depth
of the model's training, activated at the cost of knowing the correct words to write.

## ADR Protocol — Persistent Memory

Every non-obvious architectural decision produces an ADR before implementation begins.
An unrecorded architectural decision is a gap in the grammar.

Without an ADR, the AI will "improve" intentional decisions that appear suboptimal
without context — turning deliberate architectural tradeoffs into silently-introduced drift.

### Format (minimal)
```markdown
# ADR-NNNN: [Decision Title]

**Date**: YYYY-MM-DD
**Status**: Proposed | Accepted | Deprecated | Superseded by ADR-NNNN

## Context
What is the situation that requires a decision? What forces are in tension?

## Decision
What was decided? State it plainly.

## Alternatives Considered
What other options were evaluated and why were they not chosen?

## Consequences
What becomes easier or harder as a result of this decision?
What will the AI need to know to work within this constraint?
```

### When to Write an ADR
- Any architectural choice that is not obvious from the code structure
- Any decision that involves a tradeoff (performance vs. simplicity, security vs. UX)
- Any decision that was reached after considering alternatives
- Any decision that future engineers (or AI sessions) might be tempted to "fix"
- Any change to the architectural constitution itself

### ADR Directory
- Path: `docs/adrs/` (zero-padded, kebab-case: `ADR-0001-short-title.md`)
- ADRs are immutable once Accepted. To change a decision: write a new ADR that supersedes the old one.
- The old ADR is updated only to add `Superseded by ADR-NNNN` to its status.

### ADR Stubs — Emit in P1
When starting a new project, emit ADR stub files as **fenced code blocks** in the first
response alongside `prisma/schema.prisma`, `tsconfig.json`, and `package.json`.
ADRs referenced only in a README but not written as files are not present in the project.
The model cannot reference a file that does not exist. Emit the file.

**Minimum ADRs to emit in P1** (adapt titles to the actual stack chosen):
- `docs/adrs/ADR-0001-stack.md` — language, runtime, framework, ORM selection and rationale
- `docs/adrs/ADR-0002-authentication.md` — auth strategy (JWT/session), hashing algorithm and why
- `docs/adrs/ADR-0003-architecture.md` — layered/hexagonal architecture decision and boundary rules

Each ADR stub must contain real content in `Status`, `Context`, `Decision`, and `Consequences`
fields — not placeholder text. A stub that says "TBD" is not an ADR.

**ADR reference check:** If your README mentions `docs/adrs/ADR-0001-stack.md`, that file
must appear as a fenced code block in the same response. A reference to a non-emitted file
is an Auditable violation — it creates the appearance of traceability without the substance.

Also emit **`CHANGELOG.md`** in P1 with initial content documenting the P1 decisions:
```markdown
# Changelog
All notable changes to this project will be documented here.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)

## [Unreleased]
### Added
- Initial project scaffold: layered architecture, Prisma schema, repository interfaces
- Authentication: JWT + Argon2 (see ADR-0002)
- Dependency registry: docs/approved-packages.md with audit baseline
- CI pipeline: lint, type-check, test, npm audit, mutation gate
- Pre-commit hooks: tsc, lint, audit, test gates
```
A CHANGELOG that exists only as "we will add one" is not Auditable. Write the file.
Document the P1 decisions immediately — the first entry is not a release entry, it is the
architectural record of what was built in this session.

### Session Protocol
Every session begins by reading the open ADRs. The status of each ADR is the authoritative
record of what is intentional. A session that modifies an ADR-governed boundary without
first reading the ADR has produced drift, regardless of whether the code compiles.

## Generative Specification: The Five Memory Types

An AI assistant has no persistent memory across sessions. The methodology distributes
memory across five artifact classes, each serving a distinct cognitive function. Every
artifact in a well-formed specification belongs to exactly one type. When an artifact
is ambiguous about which type it serves, it is trying to do too much and will do none well.

| Memory Type | Cognitive Function | Primary Artifacts |
|---|---|---|
| **Semantic** | What the system *is* — identity, contracts, constraints | `CLAUDE.md`, tech spec, domain models, glossary |
| **Procedural** | *How* things are done — execution rules, pipelines, bound prompts | `DEVELOPMENT_PROMPTS.md`, roadmap, CI/CD spec, commit hooks |
| **Episodic** | What *happened* — decisions, sessions completed, history | ADRs, `Status.md`, session summaries, git commit log |
| **Relationship** | *How things connect* — topology, flows, protocols | C4 diagrams, sequence diagrams, state machines, use cases |
| **Working** | What is *active now* — current task, loaded context, scope | Session prompt, loaded artifacts, clarification state |

### Missing Types = Compounding Failure
- **Semantic absent** → no grammar; output is locally correct and globally incoherent.
- **Procedural absent** → each session starts from scratch; nothing is reproducible.
- **Episodic absent** → decisions are repeated or overwritten; intentional choices become drift.
- **Relationship absent** → inter-component contracts are implicit; integration points drift.
- **Working absent (not loaded)** → the current session inherits no context; practitioner re-narrates everything.

A project missing all five types is using interactive prompting with no structural discipline.
Use the five types as a diagnostic before beginning any session on an inherited project.

## Status.md — Required Format

Status.md is the episodic artifact closest to working memory. Updated at the close of
every session, without exception. The "Next" section is the handoff: specific enough
that an agent could begin from it alone, without any narration.

```markdown
# [Project Name] — Status

**Last updated:** YYYY-MM-DD
**Current version / branch:**

## Completed (this session)
- [What was done, with commit hashes where relevant]

## In Progress
- [Partial state — what the immediate next step is]

## Next
- [The immediate next action — specific enough to begin from this line alone]
- Example: "Implement `updateConnectionStatus` in `src/connections/service.ts`,
  write tests for the three state transition paths, verify against `/connections/:id/status`"

## Decisions made (this session)
- [Any choice not yet in an ADR — these are ADR candidates]

## Blockers / Dependencies
- [What is waiting on an external input or a parallel workstream]
```

A vague "Next" entry ("continue working on the feature") forces the next session to
reconstruct intent. A specific "Next" entry enables a cold start from the artifact alone.
The "Next" section is the primary quality measure of Status.md.
