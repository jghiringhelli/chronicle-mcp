# ADR-002: Fold team features into chronicle-mcp as a token-gated module

- **Status**: Accepted
- **Date**: 2026-05-24
- **Supersedes**: the implicit "keep `chronicle-team` a separate package" decision taken during the v0.3.x Axon work.

## Context and Problem Statement

Team functionality grew across two packages:

- **`chronicle-mcp`** (this repo) gained the `axon` tool — team *coordination* (contributors,
  work packages, eigenvalue decomposition, assignments, merge requests), gated behind a
  `teamToken` validated against the Railway `team_licenses` table.
- **`chronicle-team`** (separate repo, `private:true`, depends on `chronicle-mcp`) holds team
  *knowledge* — shared memories, team insights, prompt logs, usage patterns — exposed via a
  single `team` tool. It is **not** token-gated and never adopted the license check.

The result is a split brain: the "team" concern lives half in core, half in an extension, with
two overlapping Railway schemas (both define `teams`) and two different gating stories. A
teammate wanting the knowledge features must install a *second* binary (`chronicle-team`) and
repoint their MCP client at it, even though coordination already ships in the core binary.

The constraint in `CLAUDE.md` — "must not become a monolith" — originally motivated the split.
But "monolith" is a property of internal coupling, not package count, and the split as it stands
delivers worse cohesion *and* worse UX than a single well-modularised package would.

## Decision Drivers

- **Single-install UX.** A teammate should add `teamId` + `teamToken` to config and restart — no
  second package, no binary switch.
- **One gating story.** Coordination and knowledge should sit behind the same license check.
- **One Railway schema** per concern, no duplicated `teams` definitions.
- **Honour "must not become a monolith"** — keep team code as an isolated feature module that the
  core memory code does not import.
- **Licensing model**: free for individuals / small research teams, paid per-seat for companies —
  served by one `team_licenses` table with seat-tier metadata.

## Considered Options

1. **Ship `chronicle-team` as the "team edition"** — keep both packages, add the license gate and a
   shared DB to the extension. Rejected: the split brain (coordination in core, knowledge in the
   extension) persists, and users still switch binaries.
2. **Consolidate all team features into `chronicle-team`** — move Axon *out* of core. Rejected:
   reverses recently shipped in-core Axon work, still a second install, more churn now.
3. **Fold `chronicle-team`'s knowledge features into `chronicle-mcp`** as a token-gated feature
   module; deprecate the separate package. **Chosen.**

## Decision Outcome

Chosen option: **3 — fold into core.** Team knowledge code moves into `chronicle-mcp` under a
self-contained `team` feature surface (services, repository, entities, schema) registered through a
single entry point and gated by the existing `validateTeamToken`. Core memory code does not import
team code; the dependency points one way (team → core), preserving acyclic module structure. The
`chronicle-team` repo is archived (or reduced to a thin re-export shim).

Related decisions locked alongside this one:

- **Single team token + DB role flag.** One `teamToken` joins a team; a `role`
  (`owner` | `lead` | `member`) on `team_members` governs who may curate. No separate owner token.
- **Assistant-driven promotion.** Memories reach the shared pool either by explicit `share` or by an
  assistant-invoked `promote` action that semantic-dedups against the team pool and folds
  near-duplicates into a `team_insight`. Promotion is deliberate, not automatic on tier change.
- **Coordination roles** stay the five GS roles (specwright/builder/merger/verifier/watcher); only
  their display label/description may be overridden.

## Consequences

**Positive**
- One install, one binary, one token for all team features.
- A single Railway team schema; the duplicate `teams` definition disappears.
- Coordination and knowledge share gating, config, and sync plumbing.

**Negative / accepted risks**
- `chronicle-mcp` grows. Mitigation: team code is an isolated module, lazy-initialised, gated; the
  free core path is unaffected when no token is present.
- Reverses a prior decision — recorded here so it is not silently re-litigated.
- The published `chronicle-team` package is deprecated; existing installs must migrate to
  `chronicle-mcp` + token. Mitigation: leave a re-export shim and note it in the README.

## More information

Builds on ADR-001 (SQLite + Railway storage). Team coordination tables were added during v0.3.x;
this ADR brings the knowledge tables into the same home.
