---
id: ADR-012
type: adr
status: active
tier: T1
properties: [self-describing, auditable]
obligations: 4
depends_on: [ADR-001, ADR-010]
---

# ADR-012: Six memory types — drop `session`, add `insight` and `coordination`

**Date:** 2026-09-10 (recorded retroactively — shipped in v0.2/v0.3)
**Status:** Accepted
**Decided by:** Juan Carlos Ghiringhelli

> **Provenance note.** `src/domain/types.ts` is the implemented decision, landed in
> `b083525` *refactor(memory): rename session->insight, confirmed:true forces core+zero-decay*
> — a rename commit, with no ADR, for a change to a persisted closed union. `coordination`
> followed with the team fold (`dca49ba`, ADR-010).
>
> This record reconciles the code with `docs/spec.md §2` ("five cognitive memory types",
> including `session`) and `package.json` ("six cognitive memory types"), which disagreed with
> each other and with the code — while `bc639ee` *docs(spec): elevate five-memory model as
> primary conceptual frame* had made the five-type model the spec's headline. The count is now
> derived from one place: the `MemoryType` union.

## Context

The original model named five types: `episodic`, `semantic`, `procedural`, `session`,
`architectural`. Two problems appeared in use.

**`session` was a tier, not a type.** Its defining property was a 7-day TTL and eviction —
which is exactly what the `buffer` tier already expresses. Keeping it as a *type* meant the
same fact ("currently migrating auth") had two valid encodings, and the decay profile
contradicted itself depending on which the caller picked.

**Two kinds of knowledge had no home.** Distilled cross-session patterns about the developer
(the output of the intelligence layer) and live team coordination state (ADR-010) were both
being written as `semantic`, where they decayed on a 35-day half-life — wrong for both. A
distilled insight should never decay; coordination state should decay slowly but not be
permanent.

## Decision

`MemoryType` is a closed union of six values, declared once in `src/domain/types.ts`:

| Type | Decays | Default tier | Holds |
|---|---|---|---|
| `episodic` | fast (~7d half-life) | buffer | something that happened |
| `semantic` | slow (~35d half-life) | working | something true right now (`confirmed: true` → core, decay 0) |
| `procedural` | never | core | how to do something |
| `architectural` | never | core | why something is built this way |
| `insight` | never | core | a synthesised pattern about the developer or team |
| `coordination` | slow (~70d half-life) | working | live team coordination state |

1. `session` is removed as a type. Ephemeral working state is `episodic` in the `buffer`
   tier; the 7-day TTL is the tier's property, not the type's.
2. `MemoryType` and `StorageTier` are **persisted values**. Adding or removing a member MUST
   have an ADR superseding this one, and MUST ship a migration for rows holding the old value.
3. The type count MUST NOT be restated as a number in prose that is not generated from
   `src/domain/types.ts`. `package.json`, `README.md`, `docs/spec.md` and `.claude/core.md`
   enumerate the six names instead of asserting a count.
4. `procedural`, `architectural` and `insight` have `decayRate: 0` and MUST NOT be pruned by
   any consolidation pass, including the janitor (spec §F10).

## Alternatives Considered

- **Keep `session` and let it coexist with the `buffer` tier.** Rejected: two encodings of
  one fact, with contradicting decay profiles; the caller had no rule to choose between them.
- **Model `insight` as a flag on `semantic` (`distilled: true`).** Rejected: the decay
  profile differs fundamentally (never vs 35-day), and a flag that changes decay is a type in
  disguise.
- **Keep `coordination` out of the memory model as a separate table.** Rejected: it would
  need its own decay, promotion and recall paths — a parallel implementation of machinery
  that already exists (ADR-010 §2).

## Consequences

**Positive.** One closed union is the single source for the model's shape. Each type has
exactly one decay profile. Team state rides the existing machinery.

**Negative.** Rows written by pre-v0.2 builds may carry `type = 'session'`; any such row is
unreadable under the current union and needs the migration named in §2 — no such migration
exists yet, which is recorded as a treatment item in `docs/gs-assessment.md` rather than left
unsaid. The JSDoc header of `src/domain/types.ts` still said "five-memory model" while
enumerating six types; corrected in the same change as this record.
