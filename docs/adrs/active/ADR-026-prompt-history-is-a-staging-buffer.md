---
id: ADR-026
type: adr
status: draft
tier: T1
properties: [defended, auditable, verifiable]
obligations: 5
depends_on: [ADR-019, ADR-012]
---

# ADR-026: Prompt history is a local staging buffer with a lifecycle, not a column that exists or does not

**Date:** 2026-10-27
**Status:** Proposed — the design is the owner's; one parameter is left open below and needs his answer.

## Context

ADR-019 §1 settled what crosses the team boundary: the distilled insight, never the prompt. It said
so in a form worth keeping — *"a flag that can be flipped is a promise; an absent column is a
property"* — and `scripts/migrate-cloud-db.mjs:90-91` dropped `raw_content` and `share_content` from
the cloud `prompt_logs` to make it so.

Read as "raw prompt text must not exist anywhere", that decision left the product unable to do the
thing it is for. Chronicle is a **chronicle**: prompts are aggregated and distilled into the work, the
style and the lessons. Distillation has to read something, and what it reads is the prompt history.
Deleting the text before anything looks at it does not protect a boundary — it removes the input.

The two readings were never distinguished in code, and the result was three defects at once:

1. **`src/services/prompt-log-service.ts` named both columns in the INSERT to Railway.** Against the
   live database, where they had been dropped, that statement cannot succeed — so the team
   prompt-log push was broken, and had been since the migration ran.
2. **`src/infrastructure/db/team-schema.ts` still declared both columns** inside
   `CREATE TABLE IF NOT EXISTS prompt_logs`. A fresh team database would therefore be handed them
   back, the push would succeed, and raw prompt text would land in a store a partner reads. The
   guarantee held only because somebody had run `cloud:migrate` once — which is
   `.claude/ledger.md` pitfall 2, *"`CREATE TABLE IF NOT EXISTS` is not a migration"*, applied to a
   privacy guarantee rather than to a feature.
3. **The shipped MCP tool advertised the capability.** `src/mcp/team-tools.ts` offered
   `share_content: 'Also share raw prompt text — explicit opt-in only'`, a promise the system had
   stopped being able to keep and should not have wanted to.

None of the three was caught by an instrument. The three RLS verifiers do not look at those columns;
only `cloud:inspect` does, by hand, and it reports the live database rather than the DDL. The defect
surfaced while correcting a citation in `reports/gs-audit-2026-10-27.md`.

## Decision

**The raw prompt text is a staging area with a lifecycle, and the lifecycle lives entirely on one
machine.** Two tables, two jobs, and the difference is the boundary:

| | `prompt_log_buffer` (local SQLite) | `prompt_logs` (cloud Postgres) |
|---|---|---|
| Role | staging area for analysis | the sharing boundary |
| Holds the raw text | **yes**, when staged | **never** |
| Lifetime | transient: staged → analysed → evicted | durable |
| Who can read it | this machine only | every team member's role, under RLS |

So ADR-019 §1 stands exactly as written **about the cloud table**, and `team-schema.ts` no longer
declares the two columns there — making it the property it claimed to be rather than a migration
somebody has to remember. The local buffer keeps `raw_content` and `share_content`, because that is
where the chronicle's input lives.

**What `share_content` means changes, and its description changes with it.** It no longer means
"share this with the team"; it means "stage the raw text locally so it can be distilled". The name
is now wrong and is deliberately left alone in this record: renaming a parameter on a published MCP
tool is a breaking change to a public API (`.claude/core.md`), and it should travel with the lifecycle
work below rather than alone.

### The lifecycle, and the part that is not built

`status` on the buffer goes `pending → pushed` today, and `pushed` records that the **pattern**
reached the team. That is not the same event as "nobody needs the local raw text any more", and one
column currently stands for both. The lifecycle this ADR proposes is:

```
staged  →  analysed  →  evicted
   │          │            └── row deleted; the space is free for the next stretch of history
   │          └── distillation has read it; profile / lessons / playbook updated
   └── `team log` wrote it, with raw_content when opted in
```

Three things are missing and none of them is a redesign:

- **Nothing analyses the staged rows.** `src/services/distill.ts` exists, asks the model for exactly
  profile, lessons and playbook, and **has no caller anywhere in `src/`** — its own header claims
  session_end invokes it and `SessionService` has four methods, none of which mentions it. It also
  takes `newMemories: Memory[]`, not prompt logs, so feeding it the buffer is a signature change.
- **Nothing evicts them.** There is no `DELETE FROM prompt_log_buffer` in `src/` or `scripts/`.
  Staged rows accumulate indefinitely, marked `pushed`.
- **No retention rule exists**, which is the open parameter below.

## The open decision

**When is a staged row done?** Two defensible answers and they are not the same product:

- **On analysis.** The row is deleted the moment distillation has read it. Minimal residency, and
  the buffer is genuinely a buffer. The cost: one failed distillation run and that stretch of
  history is gone, and a second pass over the same prompts is impossible.
- **On a TTL.** The row survives a fixed window after analysis — seven days would match the
  existing `buffer` storage tier (ADR-012), so the system would have one retention concept rather
  than two. The cost: raw prompt text sits on disk for a week after it has stopped being needed.

A third option, keeping until the user asks for deletion, is rejected in advance: "keep until
someone objects" is how a staging area becomes an archive, and this one holds the most sensitive
data in the system.

**This ADR does not choose.** The owner does, and the number goes in this section before the status
moves to Accepted.

## Alternatives Considered

**Delete `raw_content` and `share_content` everywhere, local buffer included.** This is what I
proposed before the design was explained to me, and it is wrong: it reads ADR-019 as "the text must
not exist" rather than "the text must not be shared", and it leaves distillation with no input.
Rejected.

**Keep the columns in the cloud DDL and rely on `cloud:migrate` to drop them.** Rejected — that is
the state that produced defect 2. A guarantee that depends on a script having been run is a promise,
which is the exact distinction ADR-019 drew.

**Stage the raw text in a file rather than in SQLite.** Rejected for now. The buffer already exists
with the right shape and a `status` column; a second storage mechanism would need its own eviction,
and eviction is the part that is missing either way.

## Consequences

- `team log` pushes again. The INSERT no longer names columns the cloud table does not have.
- A fresh team database can no longer be given the two columns by the schema file, so the boundary
  survives a new deployment without anyone remembering a migration step.
- The chronicle's input is preserved: the raw text is staged locally and is available to the
  distillation step whenever it is wired.
- **Raw prompt text now accumulates on disk with no eviction**, and that is strictly worse than
  before this ADR only in the sense that it is now intentional and recorded. It was already
  happening. Until the lifecycle lands, the honest statement is that `prompt_log_buffer` grows
  without bound, and anyone uncomfortable with that should not pass `share_content: true`.
- `share_content` keeps a name that no longer describes it.

## Verification

- **Verified 2026-10-27.** `tests/unit/services/prompt-log-service.test.ts` gained two assertions,
  the first written red: the statement sent to the cloud matches `INSERT INTO prompt_logs` and
  matches neither `raw_content` nor `share_content`, and the staged row still carries the raw text
  in the local buffer. Before the fix the first failed on the emitted SQL; both pass now. The fake
  `postgres` client is a recorder of the statement we emit, not a source of return shapes — the
  distinction `.claude/ledger.md` pitfall 3 insists on.
- **Verified 2026-10-27.** `cloud:inspect` against the live database reports
  `raw_content / share_content: ABSENT`, and the one real row in `prompt_logs` carries a pattern and
  no text.
- **Not verified, and it is the gap this ADR exists to close:** that a staged row is ever analysed or
  ever evicted. Neither path exists, so there is nothing to measure. No instrument currently asserts
  the absence of those two columns either — the three RLS verifiers do not check them, and
  `cloud:inspect` is not a gate. An assertion belongs in `verify-team-cloud.mjs`, where it would run
  in CI.
