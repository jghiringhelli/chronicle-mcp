---
node: adr
type: sentinel-node
scope: architecture decision records — the design envelope
load: on-demand
categories: [routing]
routes_to: [root]
---

# Architecture Decisions

Read the specific ADR before proposing any structural change to the relevant domain.
Do not re-open a decision without creating a new ADR that supersedes it.

An ADR answers *why the system is shaped this way* — the cross-cutting design envelope.
For *how one unit is built*, read its EDR instead (@docs/edrs/index.md); it is smaller and
carries the local context a change actually needs.

| ID | Decision | Status | Node |
|---|---|---|---|
| ADR-000 | Context Navigation Tree initialization (3-line root + category-declaring nodes) | Accepted | @docs/adrs/active/ADR-000-cnt-init.md |
| ADR-001 | SQLite (better-sqlite3) as the sole storage backend | Accepted · search half amended by ADR-014 | @docs/adrs/active/ADR-001-use-sqlite-with-vector-embeddings.md |
| ADR-002 | Fold chronicle-team's knowledge layer into core as a token-gated `team` tool | Accepted | @docs/adrs/active/ADR-002-fold-team-into-core.md |
| ADR-003 | Accept the transitive `tar` HIGH advisory from the optional `fastembed` | Accepted | @docs/adrs/active/ADR-003-accept-fastembed-tar-risk.md |
| ADR-010 | Fold `axon` team coordination into chronicle-mcp, cloud mirror optional | Accepted | @docs/adrs/active/ADR-010-fold-axon-coordination-into-chronicle.md |
| ADR-011 | Three action-dispatching MCP tools, not twenty flat ones | Accepted | @docs/adrs/active/ADR-011-consolidated-mcp-tool-surface.md |
| ADR-012 | Six memory types — drop `session`, add `insight` and `coordination` | Accepted | @docs/adrs/active/ADR-012-six-memory-types.md |
| ADR-013 | `docs/spec.md` is the single functional spec; `chronicle-spec.md` superseded | Accepted | @docs/adrs/active/ADR-013-single-source-spec.md |
| ADR-014 | Recall is keyword-first; semantic similarity is an optional gateway | Accepted | @docs/adrs/active/ADR-014-keyword-first-recall.md |
| ADR-015 | `better-sqlite3@13` (Node-API) instead of pinning a Node major | Accepted | @docs/adrs/active/ADR-015-node-api-better-sqlite3.md |
| ADR-016 | Concurrent multi-instance access is a supported contract | Accepted · amends ADR-001 | @docs/adrs/active/ADR-016-multi-instance-concurrency.md |
| ADR-017 | Drop `fastembed` from the install tree; baseline the SDK's advisories | Accepted · supersedes ADR-003's acceptance | @docs/adrs/active/ADR-017-supply-chain-baseline.md |

## Numbering — why it jumps from 003 to 010

The sequence is 000, 001, **002, 003**, then **010–016**. 004–009 are deliberately unused.

ADR-002 and ADR-003 came from `feat/fold-team-into-core` (v0.4.0). While that branch was
unmerged, five new ADRs were written on `master`; they were numbered from **010** specifically so
they could not collide with 002/003 — two different decisions sharing one number is a conflict no
gate can detect, because each file is individually well-formed. The gap is the seam where the two
lines of work met, and it is left visible rather than renumbered: ADRs are immutable after
acceptance.

**The next ADR on this branch is ADR-018.**

Two records that read similarly and are not the same decision: **ADR-010** put `axon`
*coordination* in core (the earlier choice); **ADR-002** folded chronicle-team's *knowledge* layer
in as a token-gated `team` tool (the later one).

## Rules this index is held to

- Every file under `docs/adrs/active/` appears in this table, and every row resolves to a
  file that exists. `scripts/gs-cascade-check.mjs` step 2 fails the build otherwise.
- Every ADR carries a `Context`, `Decision` and `Consequences` section and a status.
- An ADR is never edited after acceptance — it is superseded, or amended by a later ADR that
  names which part it replaces (see ADR-001 ← ADR-014).
- No ADR stays `Proposed` for more than 14 days. ADR-001 sat `Proposed` for five months while
  fully implemented; that is decision debt, and the rule exists because of it.
- A decision taken in code and never written down is back-filled as a retroactive ADR with a
  provenance note, not left implicit. ADR-010, ADR-011 and ADR-012 are such back-fills.
