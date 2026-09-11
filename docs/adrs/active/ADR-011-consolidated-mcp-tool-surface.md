---
id: ADR-011
type: adr
status: active
tier: T1
properties: [bounded, self-describing]
obligations: 5
depends_on: [ADR-010]
---

# ADR-011: Expose a few action-dispatching MCP tools, not twenty flat ones

> **Amended 2026-09-10 by the v0.4.0 merge: the surface is now FOUR tools, not three.**
> `team` was added by @docs/adrs/active/ADR-002-fold-team-into-core.md — a separate actor (a
> licensed team, gated on `teamToken`) with its own lifecycle, which is the one justification §1
> below allows. The rule is unchanged and still binding: a fifth root tool needs its own ADR.
> `scripts/smoke-mcp.mjs` asserts the count against the live server, and it is what caught this
> document contradicting the code within minutes of the merge.

**Date:** 2026-09-10 (recorded retroactively — shipped in v0.3.0)
**Status:** Accepted
**Decided by:** Juan Carlos Ghiringhelli

> **Provenance note.** Reconstructed from `src/mcp/server.ts` (three `server.tool(...)`
> registrations) against `docs/chronicle-spec.md`, which specifies ~20 flat tools. The
> implementation is the decision; this file records it.

## Context

`docs/chronicle-spec.md` specified a flat surface of roughly twenty MCP tools: `remember`,
`recall`, `forget`, `set_trigger`, `check_triggers`, `set_preference`, `get_preferences`,
`save_solution`, `find_solution`, `report_bias`, `get_biases`, `project_context`,
`cross_pollinate`, `session_start`, `session_end`, `session_recover`, `extract_insights`,
`get_profile`, `get_playbook`, `get_lessons`, `distill`, `teach`.

Every registered MCP tool carries its name, description and full JSON schema into the host
agent's context on *every* turn, whether used or not. Twenty tools is a fixed context tax on
a server whose entire purpose is to *reduce* the context an agent must carry. This is the
Bounded property applied to the tool surface itself.

A second pressure: several MCP hosts degrade in tool-selection accuracy as the tool count
grows, and Chronicle must work across Claude, Copilot, Cursor and Gemini.

## Decision

Register exactly **three** tools, each dispatching on an `action` argument:

| Tool | Actions | Owns |
|---|---|---|
| `chronicle` | `remember` `recall` `forget` `trigger` `check` `pref` `prefs` `stats` `decay` | memory, triggers, preferences |
| `session` | session lifecycle | session continuity |
| `axon` | `contributor_add` `spec_sync` `milestone_add` `decompose` `assign` `complete` `request_merge` `resolve_merge` `merges` `status` `queue` | team coordination (ADR-010) |
| `team` | `join` `share` `promote` `recall` `log` `insights` `stats` `sync` `members` `assign_role` `curate_insight` `mint_token` | shared team knowledge, licence-gated (ADR-002) |

1. A new capability MUST be added as an action on an existing tool unless it introduces a
   genuinely new actor. Adding a root tool requires its own ADR — `team` met that bar (ADR-002):
   its actor is a licensed team rather than the local developer, and it is inert without a
   `teamToken`, so bundling it into `chronicle` would hand every single-user install a surface it
   can never call.
2. Each tool's description MUST be agent-instructive: it tells the agent *when* to call the
   action, not merely what it does. The description is the only specification the host reads.
3. Action names MUST be stable. They are a public surface under
   `.claude/standards/api.md`; renaming one is a breaking change requiring the
   public-surface diff.
4. The flat names in `docs/chronicle-spec.md` MUST NOT be treated as the surface; that
   document is superseded (ADR-013).

## Alternatives Considered

- **Twenty flat tools as specified.** Rejected: fixed per-turn context cost, and measurably
  worse tool selection on hosts with large tool sets.
- **One single `chronicle` tool with every action.** Rejected: the three tools have different
  *lifecycles* — memory operations are per-call, `session` brackets a session, `axon` is
  inert unless a team is configured. Collapsing them would hand every user the team schema.
- **Resource/prompt primitives instead of tools.** Rejected: host support for MCP resources
  was uneven across the four target clients at the time of the decision.

## Consequences

**Positive.** Three tool schemas instead of twenty. `axon` is trivially omittable for
single-developer installs. Adding an action is a non-breaking change.

**Negative.** Action dispatch moves argument validation from the MCP schema layer into the
handler, so a bad action name fails at runtime rather than at schema-validation time — the
handler MUST therefore enumerate valid actions and fail with the list. `src/mcp/server.ts`
holds all three registrations in one 526-line file (exemption `exc-003`); this is accepted
as cohesion, not deferred debt. Documentation that names flat tools (`README.md`,
`Status.md`, `docs/use-cases.md`) drifted from the real surface and is corrected alongside
this record.
