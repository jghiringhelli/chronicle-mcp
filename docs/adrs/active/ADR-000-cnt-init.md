---
id: ADR-000
type: adr
status: active
tier: T1
properties: [bounded, self-describing]
obligations: 3
depends_on: []
---

# ADR-000: Context Navigation Tree Initialization

**Date**: 2026-03-21
**Status**: Accepted
**Decided by**: ForgeCraft setup

## Context

This project was initialized with ForgeCraft. The Context Navigation Tree (CNT)
structure was selected to provide O(log N) context load in the average case.

## Decision

Use CNT: CLAUDE.md (3-line root) + .claude/index.md (routing) + .claude/core.md
(always-loaded invariants) + domain leaf nodes (≤30 lines each).

## Consequences

- CLAUDE.md stays ≤3 lines always
- New concerns get a leaf node via `add_node`
- core.md must never exceed 50 lines; excess moves to domain nodes
- Stateless agents navigate by task domain, not by loading everything

## How this satisfies the GS five-category rule

Generative Specification requires a sentinel tree whose nodes **collectively** cover five
categories: architectural identity, standards, constraints/prohibitions, tool sequencing,
routing. The Field Guide describes a single ~250–300 line root carrying all five; the CNT
splits the same content across nodes, keeping the root at 3 lines.

The two are equivalent only if the coverage is enforced rather than assumed. It is:
each node declares its categories in `sentinel-node` frontmatter, and
`scripts/gs-cascade-check.mjs` step 1 fails the build when any of the five is undeclared,
when a `routes_to` target does not resolve, or when a node exceeds the 300-line read budget
without a recorded exemption.

Ownership of the five categories:

| Category | Node |
|---|---|
| routing | `.claude/index.md` (root), `.claude/adr/index.md`, `.claude/gates/index.md` |
| architectural-identity | `.claude/core.md`, `.claude/standards/architecture.md` |
| standards | `.claude/standards/{architecture,protocols,testing,spec,api,cicd}.md` |
| constraints | `.claude/core.md`, `.claude/ledger.md`, `.claude/standards/project-specific.md` |
| tool-sequencing | `.claude/standards/tool-sequencing.md`, `.claude/standards/cicd.md` |

## Tags
UNIVERSAL, LIBRARY