---
node: root
type: sentinel-node
scope: the one door — declares scope and routes each task to its slice
load: always
categories: [routing]
routes_to: [core, ledger, adr, gates, architecture, protocols, testing, tool-sequencing, spec, api, cicd, project-specific]
---

# chronicle Context Index

## Always Load
@.claude/core.md — identity, scope boundary, layer map, invariants
@.claude/ledger.md — corrections already made, and the traps this stack sets

## Navigate by Task
Identify the task domain before generating any code.
Load ONLY the node that matches. Do not load siblings.

| Task Domain | Node | When to Use |
|---|---|---|
| Which tool, in what order | @.claude/standards/tool-sequencing.md | Before searching, installing, or claiming done |
| Architecture decisions | @.claude/adr/index.md | Before proposing any structural change |
| Implementation detail of one unit | @docs/edrs/index.md | Before changing a service, adapter or schema |
| Quality gates | @.claude/gates/index.md | When running or interpreting gate results |
| Architecture | @.claude/standards/architecture.md | Layer rules, SOLID, patterns, code standards |
| Protocols | @.claude/standards/protocols.md | Commit convention, branching, dependency registry |
| Testing | @.claude/standards/testing.md | TDD sequence, coverage and mutation targets |
| Spec lifecycle | @.claude/standards/spec.md | Release phase, cascade, required artifacts |
| CI / hooks | @.claude/standards/cicd.md | Pipeline, hook emission, commit hygiene |
| Public API surface | @.claude/standards/api.md | Changing an exported name or MCP tool shape |
| Chronicle-specific rules | @.claude/standards/project-specific.md | Tier model, sync semantics, dashboard contracts |

## Specification corpus
| Artifact | Path | Role |
|---|---|---|
| Product brief | @docs/PRD.md | Why the system exists, for whom, success metrics |
| Functional spec | @docs/spec.md | The authoritative source of behaviour (single source) |
| Behavioural contracts | @docs/use-cases.md | UC-001…UC-008, acceptance criteria |
| Technical contracts | @docs/TechSpec.md | Data shapes, MCP tool contracts, NFR thresholds |
| GS self-assessment | @docs/gs-assessment.md | Seven-property score, anchors, treatment plan |
| Current state | @Status.md | Derived status — every claim cites docs/evidence/ |

`docs/chronicle-spec.md` is the superseded v0 design document. It is retained for
provenance only and MUST NOT be read as current behaviour (see @docs/adrs/active/ADR-013-single-source-spec.md).

---

## Navigation Protocol — read before any task

1. Read this file (index.md). Identify the task domain from the table above.
2. Read .claude/core.md and .claude/ledger.md. Always. They are always relevant.
3. Read the domain index for the matching task domain. One domain only.
4. If the task touches an architecture decision, read .claude/adr/index.md and the relevant ADR.
   If it touches one unit's implementation, read that unit's EDR instead — it is smaller.
5. If the task touches quality gates, read .claude/gates/index.md and
   .claude/standards/tool-sequencing.md §4 for the order they run in.
6. Do not read nodes outside the identified domain unless the task explicitly spans domains.
   If it spans domains, name them before reading both — do not load the full tree silently.
7. If no node matches the task, read core.md only and flag the missing coverage.

## Tree invariants — enforced, not asserted
`node scripts/gs-cascade-check.mjs` fails the build when: a node exceeds the 300-line read
budget without a recorded exemption; the five categories are not collectively declared
(`architectural-identity`, `standards`, `constraints`, `tool-sequencing`, `routing`); a
`routes_to` target does not resolve; an `@path` in this file points at a missing file; or a
node still carries an unresolved Handlebars-style template hole.
