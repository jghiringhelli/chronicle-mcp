---
id: ADR-013
type: adr
status: active
tier: T1
properties: [self-describing, composable, auditable]
obligations: 5
depends_on: [ADR-011, ADR-012]
---

# ADR-013: One functional spec — `docs/spec.md`; `chronicle-spec.md` is superseded

**Date:** 2026-09-10
**Status:** Accepted
**Decided by:** Juan Carlos Ghiringhelli

## Context

Four documents claimed authority over Chronicle's behaviour:

| File | Lines | State found |
|---|---|---|
| `docs/spec.md` | 282 | real, current, with NFR thresholds — but scope section contradicted the code |
| `docs/chronicle-spec.md` | 947 | the v0 design document: ~20 flat MCP tools, "three-tier memory model", five types |
| `docs/PRD.md` | 27 | unfilled ForgeCraft template ("PRD: My Project", "- FR-001: [requirement]") |
| `docs/TechSpec.md` | 29 | unfilled ForgeCraft template |

A stateless reader handed this set cannot determine the system's behaviour: the two filled
documents disagree on the tool surface and the memory model, and the two empty ones occupy
required cascade slots — `forgecraft.yaml` declares `functional_spec` (→ `docs/PRD.md`)
required, so the cascade reported a satisfied step over a template.

This is the *declared rigor vs derivable guarantee* failure the rubric's R6 (single source)
and the negative test case "flagship output unimplemented under a 'done' narrative" are
written to catch.

## Decision

1. **`docs/spec.md` is the single authoritative functional specification.** Where any other
   document disagrees with it, `docs/spec.md` wins; where it disagrees with `src/`, the
   change is not done until one of the two is corrected in the same commit.
2. **`docs/chronicle-spec.md` becomes a provenance artifact.** It carries
   `status: superseded` frontmatter and a header banner naming what replaced it. It MUST NOT
   be read as current behaviour and MUST NOT be edited to track the code; it is retained only
   because it holds the original reasoning for the tier model and the intelligence-layer
   artifact shapes.
3. **`docs/PRD.md` is filled as a product brief** — intent, users, jobs-to-be-done, success
   metrics, out of scope — and MUST NOT restate behaviour. Behaviour lives in `spec.md`.
4. **`docs/TechSpec.md` is filled as the technical contract** — data shapes, MCP tool
   contracts, quantified NFR thresholds. It derives from `spec.md`; it does not compete with it.
5. A required cascade artifact MUST NOT remain an unfilled template. `scripts/gs-cascade-check.mjs`
   step 3 fails the build on stub markers in any artifact `forgecraft.yaml` declares required.

## Alternatives Considered

- **Delete `chronicle-spec.md`.** Rejected: it is the only record of *why* the three-tier
  model and the `profile/lessons/playbook` artifact shapes look as they do. Deleting it would
  trade a drift problem for a lost-rationale problem (Auditable).
- **Merge `chronicle-spec.md` into `spec.md`.** Rejected: the merge product would be ~1,100
  lines, past the read budget, and would need a spec-map to be loadable at all — real work,
  but not work this decision needs to block on. Retain + supersede now; split into
  `docs/specs/` sections if `spec.md` itself passes ~500 lines.
- **Delete the `PRD.md` / `TechSpec.md` stubs and point the manifest at `spec.md`.** Rejected:
  the product brief and the technical contract answer questions `spec.md` deliberately does
  not (why it exists for whom; exact wire shapes). Filling them is the smaller lie to unwind.

## Consequences

**Positive.** One answer per question. The cascade check can now fail on a stub, so the class
of failure is unreachable rather than merely discouraged.

**Negative.** Four documents must be kept consistent by hand where one would have sufficed;
the mitigation is that only `spec.md` is normative, so the others can be thin. Any external
link into `docs/chronicle-spec.md` now lands on a superseded document — acceptable, since the
banner names the replacement.
