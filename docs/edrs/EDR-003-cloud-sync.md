---
id: EDR-003
type: edr
status: active
tier: T2
properties: [executable, composable]
obligations: 6
depends_on: [ADR-010]
---

# EDR-003: Cloud sync — boundary-triggered, last-access-wins mirror

**Governs:** `src/services/sync.ts`, `src/infrastructure/db/cloud-schema.sql`
**Derives from:** ADR-010 (the cloud mirror is optional and secondary)

## Function — what this unit does

Mirrors local state to an optional Postgres (Railway) and back, in four independent passes:

| Pass | Direction | Scope |
|---|---|---|
| `syncMemories()` | push + pull | `working` and `core` memories |
| `syncInsights()` | push + pull | distilled intelligence-layer rows |
| `pushSessionSummary(session)` | push only | one ended session |
| `syncCoordination(project?)` | push + pull | team coordination state |

**Contract**

- Each function MUST return `{ pushed, pulled, conflicts, skipped }` and MUST return
  `skipped: true` — never throw, never partially write — when `config.railwayUrl` is unset.
  `syncCoordination` additionally requires `config.teamId`. **Absence of configuration is a
  normal state, not an error.** This is ADR-010 §3 made mechanical.
- SQLite remains the source of truth. A pass MUST NOT delete a local row, and MUST NOT be the
  only place a write lands.
- Callers MUST invoke these only at session boundaries (`session_end` → push,
  `session_start` → pull). Calling one inside a `recall` path violates ADR-010 §4 and the
  <50ms contract.
- `buffer`-tier memories MUST NOT be pushed: they are ephemeral by definition and would make
  every device pay for another device's scratch state.

## Implementation — how it does it

**Conflict resolution is last-*access*-wins, on both sides.** It is not last-write-wins and
not a merge:

- Push: `ON CONFLICT (id) DO UPDATE … WHERE EXCLUDED.last_accessed_at > memories.last_accessed_at`.
  A stale device's row is discarded by the database, not by the client.
- Pull: the row is skipped when `existing.last_accessed_at >= remote.last_accessed_at`.

`last_accessed_at` is an **ISO-8601 string compared lexicographically**, which is only
equivalent to chronological comparison because every writer emits `toISOString()` — same
length, same `Z` suffix, zero-padded. A writer emitting a local offset (`+02:00`) would
compare wrongly and silently lose updates. Every write path MUST use `toISOString()`.

**Only four fields are reconciled** — `weight`, `access_count`, `last_accessed_at`, `tier`.
Content is immutable after creation (EDR-001), so there is nothing else to merge. A future
edit-in-place feature would need a real merge strategy and a new ADR.

**`conflicts` is always reported as `0`.** The field exists in `SyncResult` but nothing
increments it: discards happen inside the SQL `WHERE` on push, and in a `continue` on pull,
neither of which counts. The number is therefore **not a signal** — do not build a dashboard
panel or an alert on it. Either count the discards or remove the field.

**The cursor is per `(device_id, user_id)`**, and a first run uses
`'1970-01-01T00:00:00Z'` — a full sync. Note `syncMemories` pulls using
`cursor.last_push_at`, not `last_pull_at` (`syncInsights` uses `last_pull_at`). The
asymmetry is unexplained by any decision and is a suspected defect: it makes the memory pull
window depend on when this device last *pushed*, so a device that pulls without pushing can
re-pull the same window repeatedly or, after a long quiet period, open a wider window than
intended. Flagged, not changed — a fix needs a regression test first, and is tracked as a
treatment item.

**Pull excludes own writes** via `source_device != deviceId`, so a device never re-ingests
its own push.

## Do not change without reading this

- **Do not make `skipped` an exception.** Unconfigured is the common case; throwing there
  breaks every local-only install, which is most of them.
- **Do not push `buffer` memories** to "make sync complete".
- **Do not replace the ISO-string comparison with a `Date` parse** without checking every
  writer: the string comparison is correct *because* of the uniform format, and a parse that
  tolerates offsets hides the bug instead of fixing it.
- **Do not move a sync call into a recall or remember path** for freshness. It adds a network
  round-trip to the hot path.

## Verification

- **No tests exist for this unit.** 522 lines, four passes, a conflict policy and a cursor,
  all unverified — the largest untested surface in the repository. Recorded as a P1 treatment
  item in `docs/gs-assessment.md`.
- Minimum to close it: a fake `sql` client asserting (1) `skipped: true` with no
  `railwayUrl`, (2) push discards a stale row, (3) pull skips a local row that is newer,
  (4) `buffer` rows are never pushed, (5) the cursor advances exactly once per pass.
