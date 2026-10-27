---
id: EDR-005
type: edr
status: active
tier: T2
properties: [defended, bounded, verifiable]
obligations: 6
depends_on: [ADR-026, ADR-019, ADR-012]
---

# EDR-005: Prompt history lifecycle — staged, analysed, evicted

**Governs:** `src/services/prompt-log-service.ts`, `src/services/distill.ts`,
`src/adapters/repositories/sqlite-team-repository.ts` (the `prompt_log_buffer` methods),
`src/infrastructure/db/database.ts` (the `analysed_at` migration)
**Derives from:** ADR-026 (prompt history is a staging buffer), ADR-019 §1 (the sharing boundary),
ADR-012 (the `buffer` tier's seven-day TTL)

## Function — what this unit does

Turns the prompt history from an append-only pile into the three-stage buffer ADR-026 describes.

| Stage | How it is recorded | Who moves it |
|---|---|---|
| **staged** | a row in `prompt_log_buffer`, `analysed_at IS NULL` | `team log` |
| **analysed** | `analysed_at` set to an ISO instant | the distillation apply phase |
| **evicted** | the row is deleted | `evictAnalysed`, at session end |

**Contract**

- The raw text never leaves the machine. The cloud `INSERT` names no `raw_content` and no
  `share_content`, and the cloud DDL declares neither (ADR-019 §1, ADR-026).
- **`status` and `analysed_at` are two independent lifecycles and MUST NOT be conflated.** `status`
  (`pending` → `pushed`) records whether the *pattern* reached the team. `analysed_at` records
  whether *distillation has read the local text*. One row can be pushed and unanalysed, or analysed
  and unpushed, and both are normal states.
- Eviction MUST NOT delete a row whose pattern never reached the team **while a remote is
  configured** — that would lose the pattern as well as the text. With no remote configured the
  pattern has nowhere to go, so `pending` is terminal and the row is evictable; otherwise an
  offline-only user's buffer would grow forever, which is the bug this unit exists to end.
- Retention is `promptRetentionDays`, default **7**, matching the `buffer` storage tier so the
  system has one retention concept rather than two (ADR-012). **`0` means delete on analysis**, which
  is the minimal-residency option ADR-026 weighed; the default is the recoverable one, because a
  failed distillation run with `0` loses that stretch of history with no second pass.
- `markPromptLogsAnalysed` MUST be idempotent: re-analysing a row refreshes `analysed_at` and
  nothing else. An agent that calls the apply phase twice must not corrupt the lifecycle.
- Distillation reads **both** sources. Memories supply the facts; the staged prompt history supplies
  the work and the style, which is the half that made this a chronicle rather than a store.
  `buildDistillPrompt` takes the prompt history as its third argument and defaults it to empty, so
  the memory-only call stays valid.

## Implementation — what is load-bearing

**`analysed_at` is a column migration, not a schema edit.** It goes in `COLUMN_MIGRATIONS` in
`database.ts` and `SCHEMA_VERSION` moves 2 → 3. Adding it to `SCHEMA_SQL` alone would do nothing to
any database that already exists — `CREATE TABLE IF NOT EXISTS` skips the whole statement, column
and all — and that is the break recorded as pitfall 2 in `.claude/ledger.md`. It is nullable with no
default, which is correct: a row that predates this unit has not been analysed, and `NULL` says so.

**Why `analysed_at` is a timestamp and not a boolean.** Retention needs to know *when*, so a boolean
would force a second column the first time someone asked for a TTL. One nullable timestamp carries
both the fact and the moment.

**Two phases, because this server cannot sample.** `distill.ts` was written to sandwich an LLM turn —
`buildDistillPrompt` on one side, `applyDistillResult` on the other — and its header claims MCP
sampling. There is no sampling support anywhere in this codebase, and the client, not the server,
would have to offer it. So the two halves are exposed as one MCP action with two modes:
`session(action:'distill')` returns the prompt and the ids it covers; `session(action:'distill',
result)` applies the synthesis, marks those ids analysed and evicts what retention releases. The
calling agent *is* the model, so the round-trip is the agent's own turn and no sampling channel is
needed. The shape deliberately mirrors `gs step`: without arguments it returns what it needs, with
them it acts.

**The ids travel with the request.** The apply phase marks exactly the ids the build phase returned,
not "everything unanalysed now" — otherwise a row staged *during* the agent's turn would be marked
analysed without having been read. That is a small window and it is the kind that produces a silent
gap in the chronicle.

**Eviction runs at session end, after the pushes.** Same reasoning as the decay and promotion order
in the `end` handler: evict only once the pattern has had its chance to reach the team in the same
turn.

## Verification

- `tests/unit/services/prompt-log-service.test.ts` — the emitted cloud statement names neither
  column; the staged row keeps the raw text locally; a staged row is unanalysed until marked; an
  analysed row survives until retention elapses; retention `0` evicts on analysis; an unpushed row
  is kept while a remote is configured and evicted when none is.
- `tests/unit/infrastructure/local-migration.test.ts` — `analysed_at` is added to a database built
  *without* it, which is the only way to test this class of change (pitfall 2).
- Not verified here: that the distillation output is any good. This unit guarantees the lifecycle,
  not the quality of the synthesis, and no test can assert the latter.
