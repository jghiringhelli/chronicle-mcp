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
| ADR-010 | Fold team coordination into chronicle-mcp (`axon`), cloud mirror optional | Accepted | @docs/adrs/active/ADR-010-fold-axon-coordination-into-chronicle.md |
| ADR-011 | Three action-dispatching MCP tools, not twenty flat ones | Accepted | @docs/adrs/active/ADR-011-consolidated-mcp-tool-surface.md |
| ADR-012 | Six memory types — drop `session`, add `insight` and `coordination` | Accepted | @docs/adrs/active/ADR-012-six-memory-types.md |
| ADR-013 | `docs/spec.md` is the single functional spec; `chronicle-spec.md` superseded | Accepted | @docs/adrs/active/ADR-013-single-source-spec.md |
| ADR-014 | Recall is keyword-first; semantic similarity is an optional gateway | Accepted | @docs/adrs/active/ADR-014-keyword-first-recall.md |
| ADR-015 | `better-sqlite3@13` (Node-API) instead of pinning a Node major | Accepted | @docs/adrs/active/ADR-015-node-api-better-sqlite3.md |
| ADR-016 | Concurrent multi-instance access is a supported contract | Accepted · amends ADR-001 | @docs/adrs/active/ADR-016-multi-instance-concurrency.md |

## Numbering — 002–009 are reserved

ADRs written on `master` run 000, 001, then 010–016. That is deliberate: the unmerged branch
`feat/fold-team-into-core` (v0.4.0, 8 commits) already carries `docs/adrs/ADR-002-fold-team-into-core.md`
and `docs/adrs/ADR-003-accept-fastembed-tar-risk.md`. **Numbers 002–009 belong to that branch.**

When it merges, both sets coexist without collision — but the merge still owes three things:

1. That branch's ADRs live at `docs/adrs/` (flat), not `docs/adrs/active/`. Move them, or the
   cascade check will not see them.
2. Add both to this table.
3. Reconcile them with the records here: its ADR-002 (fold the team **knowledge** layer in as a
   token-gated `team` tool) is a later decision than ADR-010 (put `axon` **coordination** in core),
   and its ADR-003 (accept the `fastembed` tar advisory) needs a row in
   @docs/dependency-policy.md, where no exception is currently recorded. Its fastembed gateway
   also partly answers ADR-014 — semantic de-dup at promote time exists there; semantic *recall*
   still does not.

Tracked as a merge hazard in @docs/gs-assessment.md.

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
