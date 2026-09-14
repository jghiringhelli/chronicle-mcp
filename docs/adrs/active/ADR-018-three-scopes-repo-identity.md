---
id: ADR-018
type: adr
status: active
tier: T1
properties: [self-describing, bounded, composable]
obligations: 9
depends_on: [ADR-012, ADR-016, ADR-002]
---

# ADR-018: Three memory scopes, project identity derived from the repository, multi-machine by default

**Date:** 2026-09-11
**Status:** Accepted
**Amends:** ADR-010 §4 (which described a sync nothing called) and ADR-016 (which scoped concurrency
to one machine)

## Context

Chronicle had one sharing axis and it was implicit. `memories.project` is a free-text, nullable
column whose comment reads `NULL = cross-project`, and **nothing derives it** — there is no repo
detection anywhere in the codebase. The label is whatever string the calling agent passes, which
means the same repository is remembered as `chronicle`, `chronicle-mcp` or `Chronicle` depending on
what the model guessed that session. That is architectural drift inside the tool built to prevent it.

Three other facts forced this decision:

1. **The author uses Chronicle on several machines.** Multi-machine support existed only in the
   cursor's shape (`sync_cursor` is keyed `(device_id, user_id)`), while `syncMemories`,
   `syncInsights` and `pushSessionSummary` are exported and **called by no production code path** —
   verified repo-wide. The personal mirror was unreachable, which is why `users`, `memories` and
   `sync_cursor` are all empty in the live Railway database while the team tables hold real rows.
2. **Multi-machine is not a layer.** It is a property every layer needs. Treating it as a feature of
   the cloud mirror produced a design where the team layer synced and personal memories did not.
3. **Repository identity must be derivable, and directory names are not it.** Measured across the
   25 repositories in this workspace: `mcp/chronicle` has the directory name `chronicle` and the
   remote `github.com/jghiringhelli/chronicle-mcp`; `mcp/CodeSeeker` is capitalised while its remote
   is lowercase. A project id derived from the directory would fail to join the same repository
   across two machines that cloned it under different names — which is precisely the case this
   decision exists to serve.

## Decision

### 1. Three scopes, declared

A memory carries a `scope`, a closed union of three values:

| Scope | Answers | Keyed by | Crosses machines | Crosses people |
|---|---|---|---|---|
| `project` | what is true about **this repository** | repo identity | yes | only via the team layer (ADR-019) |
| `person` | what is true about **me**, anywhere | `userId` | yes | no |
| `team` | what the **team** has agreed or learned | `teamId` | yes | yes, by construction |

`scope` is a persisted value. Adding or removing a member requires an ADR superseding this one and a
migration, exactly as ADR-012 requires of `MemoryType`.

**Why not derive scope from `project == NULL`.** It is tempting — the column comment already
implies it — and it is wrong: it conflates *"not about a repository"* with *"about me"*, so a
personal preference scoped to one repo ("in this codebase I prefer early returns") has no
representation. Implicit scope is the kind of thing that drifts, which is the whole subject of this
record.

### 2. Project identity is derived, not supplied

`project` MUST be a derived repository identity, resolved in this order:

1. **Normalised remote** — `remote.origin.url` reduced to `host/owner/repo`: strip the scheme, any
   embedded credentials, the `git@host:` form, a trailing `.git`, and lowercase it. Yields
   `github.com/jghiringhelli/chronicle-mcp`. Stable across clones, directory names, OSes and
   protocols. Present for 24 of 25 repositories measured here.
2. **Root commit** — `repo:<first 12 of the root commit sha>` when there is no remote. Immutable,
   survives renames and remote changes, opaque but unique (all 25 distinct).
3. **Directory name** — `dir:<basename>` only when the directory is not a git repository at all.
   Explicitly prefixed, because it is the unstable case and a reader should see that.

The resolved id MUST carry its provenance (`remote` | `root-commit` | `directory` | `explicit`) so a
reader can tell a stable id from a fallback.

An explicit `project` argument still wins — a caller who knows better than the filesystem is not
overruled — but it is no longer how identity is normally established.

**The server can do this.** Measured: a stdio MCP server inherits its host's working directory, so
`process.cwd()` is the repository the session is working in. Detection is cached per process, since
one server serves one session.

### 3. Multi-machine is on when a remote exists

Presence of `railwayUrl` enables cross-machine sync for **every** scope. There is no second flag.
Absence of `railwayUrl` is single-machine operation, and every local operation MUST behave
identically (ADR-010 §3) — the one case where multi-machine is simply not a property of the system.

`syncMemories` and `syncInsights` MUST be invoked at session boundaries: pull at `session start`,
push at `session end`. This is what ADR-010 §4 already required and no code did.

Sync MUST remain outside the `recall` path. A boundary is a boundary precisely so the hot path never
pays for the network.

### 4. Conflict resolution is unchanged and now actually reachable

Last-access-wins, comparing ISO strings lexicographically (EDR-003). That policy was written for
this case and had never run; the timestamp normalisation in `src/shared/time.ts` is what makes it
correct against a real Postgres.

## Alternatives Considered

- **Keep `project` free-text and tell agents to be consistent.** Rejected: it is the instruction-over-
  structure move the whole method argues against. The tool descriptions already ask for a project tag
  and the result was three spellings of one repository.
- **Derive the project id from the directory name.** Rejected on measurement, not taste: two of 25
  repositories already differ from their remote name, so the ids would not join across machines.
- **Use the root commit as the primary id.** Rejected as primary, kept as fallback: it is stable but
  unreadable, and a human reading `recall` output should see `github.com/owner/repo`, not a hash.
- **A fourth `device` scope.** Rejected, and this is the heart of the decision: a memory is never
  *about* a machine. Machines are where memories are used, not what they are about. Adding a device
  scope would have made multi-machine a layer instead of a property.
- **Sync inside `recall` for freshness.** Rejected: it puts a network round trip in the path with the
  <50ms contract.

## Consequences

**Positive.** The same repository resolves to the same id on every machine and in every session, so
project-scope recall actually joins. Scope is explicit, so "share this with the team" and "keep this
to me" are representable rather than inferred. Multi-machine stops being a feature of one layer.

**Negative.** `scope` is a new persisted column: a migration, and a value every write path must set.
The local store is empty and the cloud personal tables are empty, so **no data has to be migrated** —
this is the cheapest moment this change will ever be, and it is the reason to do it now rather than
after field use.

Repository detection runs `git` in a subprocess at startup. It is cached per process and must never
be on a recall path; if `git` is absent the resolution falls through to the directory name.

A derived id changes what existing free-text labels mean. Since the store is empty the question is
academic today, but a future import of labelled memories needs a mapping, not an assumption.

## Verification

- `tests/unit/shared/repo-identity.test.ts` — each derivation rule, the normalisation cases measured
  here (ssh vs https, `.git` suffix, capitalisation, credentials in the URL), and the fallback chain.
- The derivation was validated against all 25 repositories in this workspace before being written:
  24 resolved by remote, all ids distinct, one repository with no remote exercising the fallback.
- Multi-machine push/pull against the real Railway Postgres: `scripts/verify-cloud-sync.mjs`.
- **Not yet verified:** two actual machines. The cross-machine test here simulates a second device by
  varying `deviceId`, which exercises the cursor and the conflict policy but not a real second host.
