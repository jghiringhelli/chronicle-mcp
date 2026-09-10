---
id: ADR-010
type: adr
status: active
tier: T1
properties: [auditable, composable]
obligations: 4
depends_on: [ADR-001]
---

# ADR-010: Fold `axon` team coordination into chronicle-mcp rather than ship a separate package

> **Numbering note.** This and ADR-011…ADR-014 were written as ADR-002…ADR-006 and renumbered
> before landing. The unmerged branch `feat/fold-team-into-core` (v0.4.0) already carries
> `docs/adrs/ADR-002-fold-team-into-core.md` and `ADR-003-accept-fastembed-tar-risk.md`. **002–009
> are reserved for that branch.** Two different decisions under one number is a merge conflict and,
> worse, two records a reader cannot tell apart.
>
> That branch's ADR-002 is a *different, later* decision: folding chronicle-team's **knowledge**
> features in as a token-gated `team` tool with semantic promote. This ADR is the **earlier**
> decision that put `axon` coordination in core. Both are real; they must not share a number.

**Date:** 2026-09-10 (recorded retroactively — decision taken ≈2026-07, shipped in `axon`)
**Status:** Accepted
**Decided by:** Juan Carlos Ghiringhelli

> **Provenance note.** This decision was taken and implemented before it was recorded. The
> record is reconstructed from the shipped surface (`src/services/coordination-service.ts`,
> the `axon` MCP tool, `src/infrastructure/db/team-schema.ts`, `src/services/sync.ts`), from
> session memory, and from the commit history, which shows the reversal plainly:
>
> - `c69bc71` feat: Chronicle Team + 3-tool consolidation
> - `f81f43f` refactor: strip team code into separate chronicle-team package — *the split*
> - `dca49ba` feat: add Axon team coordination tool + token gate (v0.3.0) — *the re-fold*
>
> The project split the team layer out and then folded it back in, with no record of why
> either way. This ADR is the missing record. It is filed under the *Orphan ADR* recovery in
> `repository-discipline.md §12`: a decision visible in the code and absent from the record
> is back-filled, not left implicit.

## Context

Chronicle's local memory model is per-developer by construction: one SQLite file at
`~/.chronicle/chronicle.db`, no network in the hot path. A team experiment (the Generative
Specification study with an external team) needed a *shared* layer — who owns which work
package, which merges are blocked, which insights generalise across developers.

Two shapes were available: a second distributable (`chronicle-team`) consuming
`chronicle-mcp` as a library, or one distributable carrying both layers with the team layer
inert unless configured.

The forcing constraint was adoption cost during an experiment: a second install, a second
MCP registration and a second config file per participant, for a layer whose value was
unproven.

## Decision

Fold the team layer into `chronicle-mcp`.

1. The team layer is exposed as **one** MCP tool, `axon`, with action dispatch — it MUST NOT
   add tools to the root surface (see ADR-011).
2. Team state is modelled as a memory type, `coordination`, not as a parallel store — it
   decays, promotes and is recalled by the same machinery (see ADR-012).
3. The cloud mirror (Railway Postgres, `src/services/sync.ts`) is **optional and
   secondary**. SQLite remains the source of truth; absence of `railwayUrl` MUST leave every
   local operation unchanged.
4. Sync MUST only run at session boundaries (`session_end` → push, `session_start` → pull),
   never inside a `recall` path, so the <50ms recall contract is unaffected.

## Alternatives Considered

- **Separate `chronicle-team` package consuming chronicle as a library.** Rejected: doubles
  install and MCP-registration cost per participant; the library entrypoint (`src/lib/`)
  existed but version skew between the two packages would be borne by experiment subjects.
- **Team layer as a hosted service with chronicle as a thin client.** Rejected: breaks the
  local-first guarantee in `core.md`, and makes the experiment depend on an uptime story
  that did not exist.
- **No team layer; use the commit log and ADR archive as the team memory.** Rejected for
  the experiment specifically (that is the documented fallback for teams ≤5 in
  `repository-discipline.md §11`), because the experiment needed *cross-developer* pattern
  capture, which the commit log does not carry.

## Consequences

**Positive.** One install, one MCP registration. Team state inherits decay and tier
promotion for free. The local-first guarantee survives: with no `railwayUrl` configured the
team layer is inert.

**Negative.** `chronicle-mcp` now carries a Postgres client (`postgres@^3`) that most users
never execute — dependency weight for an unused path. `coordination-service.ts` reached 770
lines and holds decomposition, ranking and assignment in one unit (exemption `exc-004`); it
is the strongest refactor candidate in the tree, tracked as an EDR rather than left implicit.
The `axon` surface shipped with no use case, which is the gap this ADR and UC-009 close.

**Scope correction this implies.** `docs/spec.md §6` listed "Team/shared memory" and
"Cloud sync" as out of scope for v1 while both were implemented. The spec is corrected in
the same change that files this ADR.
